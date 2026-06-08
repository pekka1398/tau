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

	write(fd, s, strlen(s));
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
	    strcmp(cmd, "sed") == 0)
		return "read";

	/* edit */
	if (strcmp(cmd, "fedit") == 0)
		return "edit";

	/* list */
	if (strcmp(cmd, "ls") == 0 ||
	    strcmp(cmd, "tree") == 0 ||
	    strcmp(cmd, "dir") == 0)
		return "list";

	/* search */
	if (strcmp(cmd, "grep") == 0 ||
	    strcmp(cmd, "rg") == 0 ||
	    strcmp(cmd, "ag") == 0 ||
	    strcmp(cmd, "ack") == 0 ||
	    strcmp(cmd, "find") == 0 ||
	    strcmp(cmd, "fd") == 0 ||
	    strcmp(cmd, "which") == 0 ||
	    strcmp(cmd, "whereis") == 0)
		return "search";

	/* filesystem ops */
	if (strcmp(cmd, "cp") == 0 ||
	    strcmp(cmd, "mv") == 0 ||
	    strcmp(cmd, "mkdir") == 0 ||
	    strcmp(cmd, "touch") == 0 ||
	    strcmp(cmd, "ln") == 0 ||
	    strcmp(cmd, "chmod") == 0 ||
	    strcmp(cmd, "chown") == 0)
		return "fs";

	return "bash";
}

/*
 * Emit compound intent from evaltree() when the top-level AST node
 * is a pipeline, chain, or control structure.
 * For NCMD (simple command), does nothing — deferred to evalcommand().
 */
void meta_emit_intent(union node *n)
{
	if (!meta_enabled() || !n)
		return;

	switch (n->type) {
	case NPIPE:
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
 * Emit simple command intent from evalcommand() with expanded argv.
 * cmdidx is the index of the real command (after skipping wrappers).
 */
void meta_emit_argv_intent(int argc, char **argv, int cmdidx)
{
	const char *cmd;
	const char *base;
	const char *intent;
	const char *path;
	char esc_cmd[256];
	char esc_path[1024];
	char buf[2048];

	if (!meta_enabled())
		return;
	if (cmdidx < 0 || cmdidx >= argc)
		return;

	cmd = argv[cmdidx];
	base = meta_basename(cmd);
	intent = classify_intent(base);

	/* Conservative path extraction: only for commands where
	 * the first non-flag arg is clearly a file/directory path */
	path = NULL;
	if (strcmp(base, "cat") == 0 || strcmp(base, "head") == 0 ||
	    strcmp(base, "tail") == 0 || strcmp(base, "bat") == 0 ||
	    strcmp(base, "fedit") == 0 || strcmp(base, "ls") == 0 ||
	    strcmp(base, "tree") == 0 || strcmp(base, "find") == 0) {
		/* First non-flag arg after command */
		int i;
		for (i = cmdidx + 1; i < argc; i++) {
			if (argv[i][0] != '-') {
				path = argv[i];
				break;
			}
		}
		/* ls/tree with no path arg defaults to "." */
		if (!path && (strcmp(base, "ls") == 0 || strcmp(base, "tree") == 0))
			path = ".";
	}

	json_escape(esc_cmd, sizeof(esc_cmd), base);
	json_escape(esc_path, sizeof(esc_path), path);

	if (path)
		snprintf(buf, sizeof(buf),
			 "{\"v\":1,\"event\":\"intent\",\"intent\":\"%s\",\"cmd\":\"%s\",\"path\":\"%s\",\"compound\":false}\n",
			 intent, esc_cmd, esc_path);
	else
		snprintf(buf, sizeof(buf),
			 "{\"v\":1,\"event\":\"intent\",\"intent\":\"%s\",\"cmd\":\"%s\",\"compound\":false}\n",
			 intent, esc_cmd);

	meta_write(buf);
}
