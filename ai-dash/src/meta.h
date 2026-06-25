#ifndef META_H
#define META_H

/* Forward declaration — avoid including nodes.h (no include guards) */
union node;

/* Check if fd 3 is available for metadata output */
int meta_enabled(void);

/* Emit compound intent from evaltree() — for pipelines, chains, etc. */
void meta_emit_intent(union node *n);

/* Emit simple command intent from evalcommand() — with expanded argv.
 * cmdidx: index of the real command in argv (after skipping wrappers).
 * redir: redirect list from ncmd.redirect (may be NULL). */
void meta_emit_argv_intent(int argc, char **argv, int cmdidx,
			   union node *redir);

#endif
