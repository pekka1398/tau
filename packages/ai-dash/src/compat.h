/*
 * Compatibility shims for older glibc versions.
 * strlcpy was added to glibc 2.38; musl already has it.
 */
#ifndef COMPAT_H
#define COMPAT_H

#include <string.h>

/* Only provide strlcpy for glibc < 2.38 (musl and others already have it) */
#if defined(__GLIBC__) && (__GLIBC__ < 2 || (__GLIBC__ == 2 && __GLIBC_MINOR__ < 38))
static inline size_t strlcpy(char *dst, const char *src, size_t size)
{
	size_t len = strlen(src);
	if (size > 0) {
		size_t copy = len < size - 1 ? len : size - 1;
		memcpy(dst, src, copy);
		dst[copy] = '\0';
	}
	return len;
}
#endif

#endif /* COMPAT_H */
