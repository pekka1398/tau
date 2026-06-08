/*
 * fedit — file edit builtin for AI-assisted shell.
 *
 * Usage: fedit <file> << 'MARKER'
 * <<<<<<< SEARCH
 * content to find
 * =======
 * replacement content
 * >>>>>>> REPLACE
 * MARKER
 *
 * Multiple SEARCH/REPLACE blocks can be chained.
 * Search matching: exact → trim trailing ws → trim all ws.
 */

#include <sys/stat.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <ctype.h>
#include <dirent.h>
#include "bltin.h"

#define INITIAL_BUF_SIZE 4096
#define INITIAL_LINES_CAP 256
#define MAX_FILE_SIZE (10 * 1024 * 1024)  /* 10MB */

/* ── Cargo-style diagnostic ──────────────────────────────────── */

static void fedit_diag(const char *code, const char *title,
		       const char *location, const char *detail,
		       const char *suggestion)
{
	outfmt(out2, "error[%s]: %s\n", code, title);
	if (location && *location)
		outfmt(out2, "  --> %s\n", location);
	outfmt(out2, "\n");
	if (detail && *detail)
		outfmt(out2, "   = detail: %s\n", detail);
	if (suggestion && *suggestion)
		outfmt(out2, "   = suggestion: %s\n", suggestion);
	outfmt(out2, "\n");
}

/* ── Edit distance for similar file suggestions ──────────────── */

static int edit_distance(const char *s1, const char *s2)
{
	int len1 = strlen(s1);
	int len2 = strlen(s2);
	int dp[128];
	int i, j, prev, tmp;

	if (len1 == 0) return len2;
	if (len2 == 0) return len1;
	if (len1 >= 128 || len2 >= 128) return 999;

	for (j = 0; j <= len2; j++)
		dp[j] = j;

	for (i = 1; i <= len1; i++) {
		prev = dp[0];
		dp[0] = i;
		for (j = 1; j <= len2; j++) {
			tmp = dp[j];
			if (s1[i-1] == s2[j-1])
				dp[j] = prev;
			else
				dp[j] = 1 + ((prev < dp[j]) ?
					     (prev < dp[j-1] ? prev : dp[j-1]) :
					     (dp[j] < dp[j-1] ? dp[j] : dp[j-1]));
			prev = tmp;
		}
	}
	return dp[len2];
}

static void suggest_nearby_file(const char *path)
{
	const char *dir, *base;
	char dirbuf[1024];
	DIR *dh;
	struct dirent *ent;
	int dist, best_dist = 3;
	char best[256] = "";
	size_t dlen;

	base = strrchr(path, '/');
	if (!base) {
		dir = ".";
		base = path;
	} else {
		dlen = base - path;
		if (dlen >= sizeof(dirbuf) - 1) return;
		memcpy(dirbuf, path, dlen);
		dirbuf[dlen] = '\0';
		dir = dlen > 0 ? dirbuf : "/";
		base++;
	}

	if (!*base) return;

	dh = opendir(dir);
	if (!dh) return;

	while ((ent = readdir(dh)) != NULL) {
		if (ent->d_name[0] == '.' && (ent->d_name[1] == '\0' ||
		    (ent->d_name[1] == '.' && ent->d_name[2] == '\0')))
			continue;
		dist = edit_distance(base, ent->d_name);
		if (dist < best_dist) {
			best_dist = dist;
			strlcpy(best, ent->d_name, sizeof(best));
		}
	}
	closedir(dh);

	if (best[0]) {
		if (strcmp(dir, ".") == 0)
			outfmt(out2, "   = suggestion: did you mean '%s'?\n", best);
		else
			outfmt(out2, "   = suggestion: did you mean '%s/%s'?\n", dir, best);
	}
}

/* ── Dynamic buffer ─────────────────────────────────────────── */

struct buf {
	char *data;
	size_t len;
	size_t cap;
};

static void buf_init(struct buf *b) {
	b->cap = INITIAL_BUF_SIZE;
	b->data = malloc(b->cap);
	b->len = 0;
	if (!b->data) error("out of memory");
}

static void buf_append(struct buf *b, const char *s, size_t n) {
	while (b->len + n > b->cap) {
		b->cap *= 2;
		b->data = realloc(b->data, b->cap);
		if (!b->data) error("out of memory");
	}
	memcpy(b->data + b->len, s, n);
	b->len += n;
}

static void buf_free(struct buf *b) {
	free(b->data);
	b->data = NULL;
	b->len = b->cap = 0;
}

/* ── Line array ─────────────────────────────────────────────── */

struct lines {
	char **items;
	size_t count;
	size_t cap;
};

static void lines_init(struct lines *l) {
	l->cap = INITIAL_LINES_CAP;
	l->items = malloc(l->cap * sizeof(char *));
	l->count = 0;
	if (!l->items) error("out of memory");
}

static void lines_add(struct lines *l, char *line) {
	if (l->count >= l->cap) {
		l->cap *= 2;
		l->items = realloc(l->items, l->cap * sizeof(char *));
		if (!l->items) error("out of memory");
	}
	l->items[l->count++] = line;
}

static void lines_free(struct lines *l) {
	free(l->items);
	l->items = NULL;
	l->count = l->cap = 0;
}

/*
 * Split buffer into lines. Modifies the buffer in-place (inserts NULs).
 * Does NOT copy — lines point into the buffer.
 */
static void split_lines(struct buf *b, struct lines *out) {
	char *p = b->data;
	char *end = b->data + b->len;
	char *start;

	lines_init(out);

	while (p < end) {
		start = p;
		while (p < end && *p != '\n') p++;
		if (p < end) {
			*p = '\0';
			p++;
		}
		lines_add(out, start);
	}

	/* Remove trailing empty line if present */
	if (out->count > 0 && out->items[out->count - 1][0] == '\0')
		out->count--;
}

/* ── Fuzzy line comparison ──────────────────────────────────── */

/*
 * Skip leading whitespace.
 */
static const char *skip_ws(const char *s) {
	while (*s == ' ' || *s == '\t') s++;
	return s;
}

/*
 * Compare two lines with fuzzy matching.
 * Level 0: exact
 * Level 1: trim trailing whitespace
 * Level 2: trim all whitespace
 * Returns 1 if match at the given level or better.
 */
static int lines_match(const char *a, const char *b, int level) {
	const char *ae, *be;

	switch (level) {
	case 0: /* exact */
		return strcmp(a, b) == 0;

	case 1: /* trim trailing */
		ae = a + strlen(a);
		be = b + strlen(b);
		while (ae > a && (ae[-1] == ' ' || ae[-1] == '\t')) ae--;
		while (be > b && (be[-1] == ' ' || be[-1] == '\t')) be--;
		return (ae - a == be - b) && memcmp(a, b, ae - a) == 0;

	case 2: /* trim all whitespace */
		a = skip_ws(a);
		b = skip_ws(b);
		ae = a + strlen(a);
		be = b + strlen(b);
		while (ae > a && (ae[-1] == ' ' || ae[-1] == '\t')) ae--;
		while (be > b && (be[-1] == ' ' || be[-1] == '\t')) be--;
		return (ae - a == be - b) && memcmp(a, b, ae - a) == 0;

	default:
		return 0;
	}
}

/*
 * Find `pattern` (count lines) in `lines` starting at `start`.
 * Uses 3-level fuzzy matching. Returns index or -1.
 */
static int seek_sequence(char **lines, size_t nlines,
			 char **pattern, size_t plen, size_t start) {
	size_t i, p;
	int level;

	if (plen == 0) return (int)start;
	if (plen > nlines) return -1;

	for (level = 0; level <= 2; level++) {
		for (i = start; i + plen <= nlines; i++) {
			int match = 1;
			for (p = 0; p < plen; p++) {
				if (!lines_match(lines[i + p], pattern[p], level)) {
					match = 0;
					break;
				}
			}
			if (match) return (int)i;
		}
	}

	return -1;
}

/* ── Patch block ────────────────────────────────────────────── */

struct chunk {
	char **search;
	size_t search_count;
	char **replace;
	size_t replace_count;
};

struct patch {
	struct chunk *chunks;
	size_t count;
	size_t cap;
};

static void patch_init(struct patch *p) {
	p->cap = 16;
	p->chunks = malloc(p->cap * sizeof(struct chunk));
	p->count = 0;
	if (!p->chunks) error("out of memory");
}

static void patch_add(struct patch *p, struct chunk *c) {
	if (p->count >= p->cap) {
		p->cap *= 2;
		p->chunks = realloc(p->chunks, p->cap * sizeof(struct chunk));
		if (!p->chunks) error("out of memory");
	}
	p->chunks[p->count++] = *c;
}

static void patch_free(struct patch *p) {
	size_t i;
	for (i = 0; i < p->count; i++) {
		free(p->chunks[i].search);
		free(p->chunks[i].replace);
	}
	free(p->chunks);
	p->chunks = NULL;
	p->count = p->cap = 0;
}

/*
 * Parse patch body into SEARCH/REPLACE chunks.
 * Works on pre-split line array (NUL-terminated strings).
 * Returns 0 on success, -1 on parse error.
 */
static int parse_lines(char **lines, size_t count, struct patch *out) {
	size_t i;
	struct chunk cur;
	int in_search, in_replace;
	size_t tmp_cap;

	patch_init(out);
	i = 0;

	while (i < count) {
		/* Look for <<<<<<< SEARCH */
		if (strcmp(lines[i], "<<<<<<< SEARCH") == 0) {
			cur.search = malloc(INITIAL_LINES_CAP * sizeof(char *));
			cur.search_count = 0;
			tmp_cap = INITIAL_LINES_CAP;
			in_search = 1;
			in_replace = 0;
			i++;

			while (i < count) {
				if (strcmp(lines[i], "=======") == 0) {
					in_search = 0;
					in_replace = 1;
					cur.replace = malloc(INITIAL_LINES_CAP * sizeof(char *));
					cur.replace_count = 0;
					tmp_cap = INITIAL_LINES_CAP;
					i++;
					continue;
				}

				if (strcmp(lines[i], ">>>>>>> REPLACE") == 0) {
					in_replace = 0;
					if (cur.search_count == 0) {
						outfmt(out2, "fedit: empty SEARCH block\n");
						free(cur.search);
						free(cur.replace);
						patch_free(out);
						return -1;
					}
					patch_add(out, &cur);
					i++;
					break;
				}

				if (in_search) {
					if (cur.search_count >= tmp_cap) {
						tmp_cap *= 2;
						cur.search = realloc(cur.search,
							tmp_cap * sizeof(char *));
					}
					cur.search[cur.search_count++] = lines[i];
				} else if (in_replace) {
					if (cur.replace_count >= tmp_cap) {
						tmp_cap *= 2;
						cur.replace = realloc(cur.replace,
							tmp_cap * sizeof(char *));
					}
					cur.replace[cur.replace_count++] = lines[i];
				}
				i++;
			}

			if (in_search || in_replace) {
				outfmt(out2, "fedit: unterminated SEARCH/REPLACE block\n");
				free(cur.search);
				free(cur.replace);
				patch_free(out);
				return -1;
			}
		} else {
			i++;
		}
	}

	return 0;
}

/* ── File I/O ───────────────────────────────────────────────── */

static int read_file(const char *path, struct buf *out) {
	int fd;
	struct stat st;
	ssize_t n;

	fd = open(path, O_RDONLY);
	if (fd < 0) return -1;

	if (fstat(fd, &st) < 0) {
		close(fd);
		return -1;
	}

	if (S_ISDIR(st.st_mode)) {
		close(fd);
		return -1;
	}

	buf_init(out);
	if (st.st_size > 0) {
		while (out->len < (size_t)st.st_size) {
			n = read(fd, out->data + out->len, st.st_size - out->len);
			if (n <= 0) break;
			out->len += n;
		}
	}

	close(fd);
	return 0;
}

static int write_file(const char *path, const char *data, size_t len) {
	int fd;
	fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
	if (fd < 0) return -1;
	while (len > 0) {
		ssize_t n = write(fd, data, len);
		if (n < 0) { close(fd); return -1; }
		data += n;
		len -= n;
	}
	close(fd);
	return 0;
}

/* ── Read stdin ─────────────────────────────────────────────── */

static int read_stdin(struct buf *out) {
	char tmp[4096];
	ssize_t n;

	buf_init(out);
	for (;;) {
		n = read(0, tmp, sizeof(tmp));
		if (n <= 0) break;
		buf_append(out, tmp, n);
	}
	return 0;
}

/* ── Apply patches ──────────────────────────────────────────── */

/*
 * Apply all chunks to the file lines.
 * Returns new line array (malloc'd) and count.
 * Returns NULL on error (search block not found).
 */
static int apply_chunks(char **file_lines, size_t file_count,
			struct patch *patch,
			char ***out_lines, size_t *out_count) {
	size_t i, j, pos, new_cap;
	char **result;
	size_t result_count;
	int found;
	struct chunk *c;

	/* Work with a copy we can grow */
	new_cap = file_count + 256;
	result = malloc(new_cap * sizeof(char *));
	result_count = 0;

	/* Copy file lines into result, applying patches */
	pos = 0;
	for (i = 0; i < patch->count; i++) {
		c = &patch->chunks[i];

		found = seek_sequence(file_lines, file_count,
				      c->search, c->search_count, pos);
		if (found < 0) {
			outfmt(out2, "fedit: SEARCH block %zu not found\n", i + 1);
			free(result);
			return -1;
		}

		/* Copy lines before the match */
		while (pos < (size_t)found) {
			if (result_count >= new_cap) {
				new_cap *= 2;
				result = realloc(result, new_cap * sizeof(char *));
			}
			result[result_count++] = file_lines[pos++];
		}

		/* Skip matched search lines */
		pos += c->search_count;

		/* Insert replace lines */
		for (j = 0; j < c->replace_count; j++) {
			if (result_count >= new_cap) {
				new_cap *= 2;
				result = realloc(result, new_cap * sizeof(char *));
			}
			result[result_count++] = c->replace[j];
		}
	}

	/* Copy remaining lines after last match */
	while (pos < file_count) {
		if (result_count >= new_cap) {
			new_cap *= 2;
			result = realloc(result, new_cap * sizeof(char *));
		}
		result[result_count++] = file_lines[pos++];
	}

	*out_lines = result;
	*out_count = result_count;
	return 0;
}

/*
 * Join lines back into a single buffer with newlines.
 */
static void join_lines(char **lines, size_t count, struct buf *out) {
	size_t i;
	size_t len;

	buf_init(out);
	for (i = 0; i < count; i++) {
		len = strlen(lines[i]);
		buf_append(out, lines[i], len);
		if (i < count - 1)
			buf_append(out, "\n", 1);
	}
	/* Final newline */
	if (count > 0)
		buf_append(out, "\n", 1);
}

/* ── Main ───────────────────────────────────────────────────── */

int feditcmd(int argc, char **argv) {
	const char *filepath;
	struct buf file_buf, patch_buf, result_buf;
	struct lines file_lines;
	struct patch patch;
	char **result_lines;
	size_t result_count;

	if (argc < 2) {
		outfmt(out2, "fedit: missing file argument\n");
		return 2;
	}

	filepath = argv[1];

	/* Read target file */
	if (read_file(filepath, &file_buf) < 0) {
		struct stat st;
		if (stat(filepath, &st) < 0) {
			fedit_diag("E2003", "File Not Found", filepath,
				   "file does not exist",
				   "check the path, or create the file first");
			suggest_nearby_file(filepath);
		} else if (S_ISDIR(st.st_mode)) {
			fedit_diag("E2004", "Is a Directory", filepath,
				   "cannot edit a directory",
				   "use 'ls' to list directory contents");
		} else {
			fedit_diag("E2002", "Read Error", filepath,
				   "permission denied or other error",
				   "check file permissions");
		}
		return 1;
	}

	/* File too large warning */
	if (file_buf.len > MAX_FILE_SIZE) {
		fedit_diag("E2005", "File Too Large", filepath,
			   "file exceeds 10MB limit",
			   "use 'sed -n 1,100p file' to read a range, or 'head -n file'");
		buf_free(&file_buf);
		return 1;
	}

	/* Read patch from stdin */
	read_stdin(&patch_buf);
	if (patch_buf.len == 0) {
		outfmt(out2, "fedit: no patch on stdin\n");
		buf_free(&file_buf);
		return 1;
	}

	/* Parse file into lines */
	split_lines(&file_buf, &file_lines);

	/* Parse patch into lines, then parse blocks */
	{
		struct lines patch_lines;
		split_lines(&patch_buf, &patch_lines);
		if (parse_lines(patch_lines.items, patch_lines.count, &patch) < 0) {
			buf_free(&file_buf);
			buf_free(&patch_buf);
			lines_free(&file_lines);
			lines_free(&patch_lines);
			return 1;
		}
		lines_free(&patch_lines);
	}

	if (patch.count == 0) {
		outfmt(out2, "fedit: no SEARCH/REPLACE blocks found\n");
		buf_free(&file_buf);
		buf_free(&patch_buf);
		lines_free(&file_lines);
		patch_free(&patch);
		return 1;
	}

	/* Apply patches */
	if (apply_chunks(file_lines.items, file_lines.count, &patch,
			 &result_lines, &result_count) < 0) {
		buf_free(&file_buf);
		buf_free(&patch_buf);
		lines_free(&file_lines);
		patch_free(&patch);
		return 1;
	}

	/* Join result and write back */
	join_lines(result_lines, result_count, &result_buf);

	if (write_file(filepath, result_buf.data, result_buf.len) < 0) {
		outfmt(out2, "fedit: cannot write %s\n", filepath);
		free(result_lines);
		buf_free(&file_buf);
		buf_free(&patch_buf);
		buf_free(&result_buf);
		lines_free(&file_lines);
		patch_free(&patch);
		return 1;
	}

	outfmt(out1, "fedit: applied %zu block(s) to %s\n", patch.count, filepath);

	free(result_lines);
	buf_free(&file_buf);
	buf_free(&patch_buf);
	buf_free(&result_buf);
	lines_free(&file_lines);
	patch_free(&patch);
	return 0;
}
