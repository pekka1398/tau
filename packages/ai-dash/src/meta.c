/*
 * Semantic metadata emission over fd 3.
 *
 * ai-dash emits a single-line JSON intent hint to fd 3 before
 * executing a command. The TUI frontend reads this to decide
 * how to render the output (syntax highlight, diff, compact, etc.).
 *
 * fd 3 is optional — if not open, nothing is emitted.
 * fd 3 has FD_CLOEXEC set so child processes don't inherit it.
 *
 * Two-phase emission:
 *   meta_emit_intent()     — called from evaltree() for compound detection
 *   meta_emit_argv_intent() — called from evalcommand() with expanded argv
 */

#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "meta.h"
#include "nodes.h"

/* Write a raw string to fd 3. Silently fails if fd 3 is not open. */
static void meta_write(const char *s)
{
	int fd = 3;
	int flags;

	flags = fcntl(fd, F_GETFD);
	if (flags == -1)
		return;

	if (!(flags & FD_CLOEXEC))
		fcntl(fd, F_SETFD, flags | FD_CLOEXEC);

	if (write(fd, s, strlen(s)) < 0) { /* ignore */ }
}

/* Minimal JSON string escape. Returns buf. */
static const char *json_escape(char *buf, size_t bufsz, const char *s)
{
	char *d = buf;
	char *end;
	const char *p;

	if (!s || bufsz == 0) {
		if (bufsz > 0) *buf = '\0';
		return buf;
	}

	end = buf + bufsz - 1;

	for (p = s; *p && d < end; p++) {
		unsigned char c = *p;
		if (c == '"' || c == '\\') {
			if (d + 2 > end) break;
			*d++ = '\\';
			*d++ = c;
		} else if (c < 0x20) {
			if (d + 6 > end) break;
			snprintf(d, end - d + 1, "\\u%04x", c);
			d += 6;
		} else {
			*d++ = c;
		}
	}
	*d = '\0';
	return buf;
}

/* Get basename: "/usr/bin/cat" -> "cat" */
static const char *meta_basename(const char *path)
{
	const char *p;
	if (!path) return NULL;
	p = strrchr(path, '/');
	return p ? p + 1 : path;
}

int meta_enabled(void)
{
	return fcntl(3, F_GETFD) != -1;
}

/*
 * Classify intent from a command basename.
 */
static const char *classify_intent(const char *cmd)
{
	if (!cmd) return "bash";

	/* read-like */
	if (strcmp(cmd, "cat") == 0 ||
	    strcmp(cmd, "head") == 0 ||
	    strcmp(cmd, "tail") == 0 ||
	    strcmp(cmd, "bat") == 0 ||
	    strcmp(cmd, "sed") == 0 ||
	    strcmp(cmd, "tac") == 0 ||
	    strcmp(cmd, "less") == 0 ||
	    strcmp(cmd, "more") == 0 ||
	    strcmp(cmd, "wc") == 0 ||
	    strcmp(cmd, "nl") == 0)
		return "read";

	/* edit */
	if (strcmp(cmd, "fedit") == 0)
		return "edit";

	/* list */
	if (strcmp(cmd, "ls") == 0 ||
	    strcmp(cmd, "tree") == 0 ||
	    strcmp(cmd, "dir") == 0 ||
	    strcmp(cmd, "lsblk") == 0 ||
	    strcmp(cmd, "lscpu") == 0 ||
	    strcmp(cmd, "lsmod") == 0 ||
	    strcmp(cmd, "lspci") == 0 ||
	    strcmp(cmd, "lsusb") == 0)
		return "list";

	/* search */
	if (strcmp(cmd, "grep") == 0 ||
	    strcmp(cmd, "rg") == 0 ||
	    strcmp(cmd, "ag") == 0 ||
	    strcmp(cmd, "ack") == 0 ||
	    strcmp(cmd, "find") == 0 ||
	    strcmp(cmd, "fd") == 0 ||
	    strcmp(cmd, "which") == 0 ||
	    strcmp(cmd, "whereis") == 0 ||
	    strcmp(cmd, "diff") == 0 ||
	    strcmp(cmd, "comm") == 0 ||
	    strcmp(cmd, "sort") == 0 ||
	    strcmp(cmd, "uniq") == 0 ||
	    strcmp(cmd, "cut") == 0 ||
	    strcmp(cmd, "awk") == 0 ||
	    strcmp(cmd, "xargs") == 0 ||
	    strcmp(cmd, "locate") == 0)
		return "search";

	/* filesystem ops */
	if (strcmp(cmd, "cp") == 0 ||
	    strcmp(cmd, "mv") == 0 ||
	    strcmp(cmd, "mkdir") == 0 ||
	    strcmp(cmd, "touch") == 0 ||
	    strcmp(cmd, "ln") == 0 ||
	    strcmp(cmd, "chmod") == 0 ||
	    strcmp(cmd, "chown") == 0 ||
	    strcmp(cmd, "rm") == 0 ||
	    strcmp(cmd, "stat") == 0 ||
	    strcmp(cmd, "file") == 0 ||
	    strcmp(cmd, "tar") == 0 ||
	    strcmp(cmd, "gzip") == 0 ||
	    strcmp(cmd, "gunzip") == 0 ||
	    strcmp(cmd, "zip") == 0 ||
	    strcmp(cmd, "unzip") == 0 ||
	    strcmp(cmd, "truncate") == 0 ||
	    strcmp(cmd, "split") == 0 ||
	    strcmp(cmd, "dd") == 0 ||
	    strcmp(cmd, "shred") == 0 ||
	    strcmp(cmd, "tee") == 0)
		return "fs";

	return "bash";
}

/*
 * Check if a command name is a "passthrough" filter — these commands
 * just select/limit output without changing the nature of the operation.
 * cat file | head -5 is still a "read", grep x file | head is still "search".
 */
static int is_passthrough(const char *cmd)
{
	return strcmp(cmd, "head") == 0 || strcmp(cmd, "tail") == 0 ||
	       strcmp(cmd, "less") == 0 || strcmp(cmd, "more") == 0 ||
	       strcmp(cmd, "nl") == 0 || strcmp(cmd, "column") == 0 ||
	       strcmp(cmd, "fold") == 0 || strcmp(cmd, "fmt") == 0 ||
	       strcmp(cmd, "pr") == 0;
}

/*
 * Get the command name (first argv[0]) from an NCMD node.
 * Returns NULL if not an NCMD or no args.
 */
static const char *get_cmd_name(union node *n)
{
	if (!n || n->type != NCMD || !n->ncmd.args)
		return NULL;
	return n->ncmd.args->narg.text;
}

/*
 * Emit compound intent from evaltree() when the top-level AST node
 * is a pipeline, chain, or control structure.
 * For NCMD (simple command), does nothing — deferred to evalcommand().
 *
 * Special case: for pipes where all commands after the first are
 * passthrough filters (head, tail, less, more), use the first
 * command's intent instead of "bash".
 */
void meta_emit_intent(union node *n)
{
	if (!meta_enabled() || !n)
		return;

	switch (n->type) {
	case NPIPE: {
		/* Check if this is a passthrough pipe: first cmd + only filters */
		struct nodelist *nl = n->npipe.cmdlist;
		if (!nl || !nl->n) break;

		const char *first_cmd = get_cmd_name(nl->n);
		if (!first_cmd) break;

		/* Check all remaining commands are passthrough */
		int all_passthrough = 1;
		struct nodelist *p;
		for (p = nl->next; p; p = p->next) {
			const char *cmd = get_cmd_name(p->n);
			if (!cmd || !is_passthrough(cmd)) {
				all_passthrough = 0;
				break;
			}
		}

		if (all_passthrough) {
			/* Use first command's intent */
			const char *intent = classify_intent(first_cmd);
			char esc[256];
			json_escape(esc, sizeof(esc), first_cmd);
			char buf[512];
			snprintf(buf, sizeof(buf),
				 "{\"v\":1,\"event\":\"intent\",\"intent\":\"%s\",\"cmd\":\"%s\",\"compound\":true}\n",
				 intent, esc);
			meta_write(buf);
		} else {
			meta_write("{\"v\":1,\"event\":\"intent\",\"intent\":\"bash\",\"compound\":true}\n");
		}
		break;
	}
	case NAND:
	case NOR:
	case NSEMI:
	case NSUBSHELL:
	case NBACKGND:
	case NIF:
	case NFOR:
	case NWHILE:
	case NUNTIL:
	case NCASE:
	case NNOT:
		meta_write("{\"v\":1,\"event\":\"intent\",\"intent\":\"bash\",\"compound\":true}\n");
		break;
	default:
		/* NCMD and others — defer to evalcommand() */
		break;
	}
}

/*
 * Scan redirect list for output redirects (>, >>) and heredocs (<<).
 * Returns: redirect type string, sets *has_heredoc if heredoc found.
 */
static const char *scan_redirects(union node *redir, int *has_heredoc)
{
	const char *result = NULL;
	union node *rp;

	*has_heredoc = 0;
	for (rp = redir; rp; rp = rp->nfile.next) {
		if (rp->type == NTO && (rp->nfile.fd == 1 || rp->nfile.fd == 2))
			result = "write";
		else if (rp->type == NAPPEND && (rp->nfile.fd == 1 || rp->nfile.fd == 2))
			result = "append";
		else if (rp->type == NHERE || rp->type == NXHERE)
			*has_heredoc = 1;
	}
	return result;
}

/*
 * Emit simple command intent from evalcommand() with expanded argv.
 * cmdidx is the index of the real command (after skipping wrappers).
 * redir is the redirect list from ncmd.redirect (may be NULL).
 */
void meta_emit_argv_intent(int argc, char **argv, int cmdidx,
			   union node *redir)
{
	const char *cmd;
	const char *base;
	const char *intent;
	const char *path;
	const char *rdir;
	int has_heredoc;
	char esc_cmd[256];
	char esc_path[1024];
	char buf[2048];
	int off;

	if (!meta_enabled())
		return;
	if (cmdidx < 0 || cmdidx >= argc)
		return;

	cmd = argv[cmdidx];
	base = meta_basename(cmd);
	intent = classify_intent(base);

	/* Conservative path extraction */
	path = NULL;

	/* find: first non-flag arg is the search path.
	 * Skip -flag and -flag value pairs. */
	if (strcmp(base, "find") == 0) {
		int i;
		for (i = cmdidx + 1; i < argc; i++) {
			if (argv[i][0] == '-') {
				/* Flags that take a value: skip next arg too */
				if (strcmp(argv[i], "-maxdepth") == 0 ||
				    strcmp(argv[i], "-mindepth") == 0 ||
				    strcmp(argv[i], "-type") == 0 ||
				    strcmp(argv[i], "-name") == 0 ||
				    strcmp(argv[i], "-path") == 0 ||
				    strcmp(argv[i], "-newer") == 0 ||
				    strcmp(argv[i], "-mtime") == 0 ||
				    strcmp(argv[i], "-exec") == 0 ||
				    strcmp(argv[i], "-ok") == 0)
					i++; /* skip value */
				continue;
			}
			path = argv[i];
			break;
		}
	}
	/* Other commands: last non-flag arg is the path */
	else if (strcmp(base, "cat") == 0 || strcmp(base, "head") == 0 ||
	    strcmp(base, "tail") == 0 || strcmp(base, "bat") == 0 ||
	    strcmp(base, "fedit") == 0 || strcmp(base, "ls") == 0 ||
	    strcmp(base, "tree") == 0 ||
	    strcmp(base, "nl") == 0 || strcmp(base, "sed") == 0 ||
	    strcmp(base, "wc") == 0 || strcmp(base, "file") == 0) {
		int i;
		for (i = argc - 1; i > cmdidx; i--) {
			if (argv[i][0] != '-') {
				path = argv[i];
				break;
			}
		}
		/* ls/tree with no path arg defaults to "." */
		if (!path && (strcmp(base, "ls") == 0 || strcmp(base, "tree") == 0))
			path = ".";
	}

	/* If command has output redirect and intent is read/search,
	 * override to "edit" since it's writing to a file */
	rdir = scan_redirects(redir, &has_heredoc);
	if (rdir && (strcmp(intent, "read") == 0 || strcmp(intent, "search") == 0))
		intent = "edit";

	/* In-place edit: sed -i, perl -i, awk -i inplace → intent = "edit" */
	if (strcmp(base, "sed") == 0 || strcmp(base, "perl") == 0 ||
	    strcmp(base, "awk") == 0) {
		int ai;
		for (ai = cmdidx + 1; ai < argc; ai++) {
			if (strcmp(argv[ai], "-i") == 0) {
				intent = "edit";
				break;
			}
			/* sed -i '', sed -iBACKUP, perl -i.bak */
			if (argv[ai][0] == '-' && argv[ai][1] == 'i') {
				intent = "edit";
				break;
			}
		}
	}

	json_escape(esc_cmd, sizeof(esc_cmd), base);
	json_escape(esc_path, sizeof(esc_path), path);

	off = snprintf(buf, sizeof(buf),
		       "{\"v\":1,\"event\":\"intent\",\"intent\":\"%s\",\"cmd\":\"%s\"",
		       intent, esc_cmd);

	if (path)
		off += snprintf(buf + off, sizeof(buf) - off,
				",\"path\":\"%s\"", esc_path);

	if (rdir)
		off += snprintf(buf + off, sizeof(buf) - off,
				",\"redirect\":\"%s\"", rdir);

	if (has_heredoc)
		off += snprintf(buf + off, sizeof(buf) - off,
				",\"heredoc\":true");

	snprintf(buf + off, sizeof(buf) - off, ",\"compound\":false}\n");

	meta_write(buf);
}
