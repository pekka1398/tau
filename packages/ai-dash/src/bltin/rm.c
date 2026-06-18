/*
 * rm — trash builtin for ai-dash.
 *
 * Behaves like standard rm but moves files to
 * ~/.local/share/Trash/ instead of deleting.
 *
 * Follows FreeDesktop trash spec:
 *   Trash/files/ — trashed files
 *   Trash/info/  — .trashinfo metadata
 *
 * Supports: -r/-R (recursive), -f (force/silent)
 */

#include <sys/stat.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include "compat.h"
#include <unistd.h>
#include <time.h>
#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include "bltin.h"
#include "../var.h"

#define TRASH_BASE ".local/share/Trash"

/* ── Recursive mkdir (like mkdir -p) ─────────────────────────── */

static void mkdir_p(const char *path, mode_t mode)
{
	char tmp[2048];
	char *p;

	snprintf(tmp, sizeof(tmp), "%s", path);
	for (p = tmp + 1; *p; p++) {
		if (*p == '/') {
			*p = '\0';
			mkdir(tmp, mode);
			*p = '/';
		}
	}
	mkdir(tmp, mode);
}

/* ── Trash directory setup ───────────────────────────────────── */

static int ensure_trash_dirs(char *files_dir, size_t files_len,
			     char *info_dir, size_t info_len)
{
	const char *home = bltinlookup("HOME");
	if (!home || !*home) {
		outfmt(out2, "rm: HOME not set\n");
		return -1;
	}

	snprintf(files_dir, files_len, "%s/%s/files", home, TRASH_BASE);
	snprintf(info_dir, info_len, "%s/%s/info", home, TRASH_BASE);

	mkdir_p(files_dir, 0755);
	mkdir_p(info_dir, 0755);

	/* Check dirs exist */
	struct stat st;
	if (stat(files_dir, &st) < 0 || !S_ISDIR(st.st_mode)) {
		outfmt(out2, "rm: cannot create trash directory: %s\n", files_dir);
		return -1;
	}
	return 0;
}

/* ── Generate unique trash name ──────────────────────────────── */

static int unique_trash_path(const char *dir, const char *basename,
			     char *out, size_t outlen)
{
	struct stat st;

	/* Try original name first */
	snprintf(out, outlen, "%s/%s", dir, basename);
	if (stat(out, &st) < 0) return 0;

	/* Try basename.1, basename.2, ... */
	for (int i = 1; i < 10000; i++) {
		snprintf(out, outlen, "%s/%s.%d", dir, basename, i);
		if (stat(out, &st) < 0) return 0;
	}

	return -1; /* too many conflicts */
}

/* ── Write .trashinfo metadata ───────────────────────────────── */

static int write_trashinfo(const char *info_dir, const char *trash_basename,
			   const char *original_abs_path)
{
	char info_path[2048];
	char content[4096];
	time_t now;
	struct tm *tm;
	char timebuf[64];
	int fd, len;

	snprintf(info_path, sizeof(info_path), "%s/%s.trashinfo",
		 info_dir, trash_basename);

	now = time(NULL);
	tm = localtime(&now);
	strftime(timebuf, sizeof(timebuf), "%Y-%m-%dT%H:%M:%S", tm);

	len = snprintf(content, sizeof(content),
		       "[Trash Info]\nPath=%s\nDeletionDate=%s\n",
		       original_abs_path, timebuf);

	fd = open(info_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
	if (fd < 0) return -1;
	if (write(fd, content, len) != len) {
		close(fd);
		return -1;
	}
	close(fd);
	return 0;
}

/* ── Resolve to absolute path ────────────────────────────────── */

static int resolve_absolute(const char *path, char *out, size_t outlen)
{
	if (path[0] == '/') {
		strlcpy(out, path, outlen);
		return 0;
	}
	char cwd[1024];
	if (!getcwd(cwd, sizeof(cwd))) return -1;
	snprintf(out, outlen, "%s/%s", cwd, path);
	return 0;
}

/* ── Trash a single entry (file or directory) ────────────────── */

static int trash_entry(const char *path, int recursive, int force,
		       const char *trash_files, const char *trash_info,
		       int *count, int verbose)
{
	struct stat st;
	char abs_path[2048];
	const char *basename;
	char dest[2048];
	char dest_basename[1024];

	if (stat(path, &st) < 0) {
		if (force && errno == ENOENT) return 0;
		outfmt(out2, "rm: cannot remove '%s': %s\n",
		       path, strerror(errno));
		return 1;
	}

	if (resolve_absolute(path, abs_path, sizeof(abs_path)) < 0) {
		outfmt(out2, "rm: cannot resolve path '%s'\n", path);
		return 1;
	}

	/* Safety check: block trashing root and HOME */
	const char *home = bltinlookup("HOME");
	if (strcmp(abs_path, "/") == 0 ||
	    (home && strcmp(abs_path, home) == 0)) {
		outfmt(out2, "rm: blocked: trashing '%s'\n", abs_path);
		return 1;
	}

	if (S_ISDIR(st.st_mode) && !recursive) {
		outfmt(out2, "rm: cannot remove '%s': Is a directory\n",
		       path);
		return 1;
	}

	basename = strrchr(path, '/');
	basename = basename ? basename + 1 : path;

	if (unique_trash_path(trash_files, basename,
			      dest_basename, sizeof(dest_basename)) < 0) {
		outfmt(out2, "rm: cannot trash '%s': name conflict\n", path);
		return 1;
	}
	const char *dest_base = strrchr(dest_basename, '/');
	dest_base = dest_base ? dest_base + 1 : dest_basename;

	snprintf(dest, sizeof(dest), "%s/%s", trash_files, dest_base);

	if (rename(path, dest) < 0) {
		outfmt(out2, "rm: cannot trash '%s': %s\n",
		       path, strerror(errno));
		return 1;
	}

	write_trashinfo(trash_info, dest_base, abs_path);

	if (verbose)
		outfmt(out1, "rm: trashed '%s' -> '%s'\n", path, dest);

	(*count)++;
	return 0;
}

/* ── Main entry point ────────────────────────────────────────── */

int rmcmd(int argc, char **argv)
{
	int recursive = 0;
	int force = 0;
	int verbose = 0;
	int i, errors = 0, count = 0;
	char trash_files[2048], trash_info[2048];

	/* Parse flags */
	for (i = 1; i < argc; i++) {
		if (argv[i][0] != '-') break;
		if (argv[i][1] == '-' && argv[i][2] == '\0') { i++; break; }
		for (int j = 1; argv[i][j]; j++) {
			switch (argv[i][j]) {
			case 'r': case 'R': recursive = 1; break;
			case 'f': force = 1; break;
			case 'v': verbose = 1; break;
			default:
				outfmt(out2, "rm: unknown option: -%c\n",
				       argv[i][j]);
				return 1;
			}
		}
	}

	if (i >= argc) {
		if (!force) {
			outfmt(out2, "rm: missing operand\n");
			return 1;
		}
		return 0;
	}

	if (ensure_trash_dirs(trash_files, sizeof(trash_files),
			      trash_info, sizeof(trash_info)) < 0)
		return 1;

	for (; i < argc; i++)
		errors += trash_entry(argv[i], recursive, force,
				      trash_files, trash_info, &count, verbose);

	if (count > 0)
		outfmt(out1, "trashed %d item(s)\n", count);

	return errors > 0 ? 1 : 0;
}
