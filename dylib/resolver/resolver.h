// Signature resolver
#ifndef NOTPROTON_RESOLVER_RESOLVER_H
#define NOTPROTON_RESOLVER_RESOLVER_H

#include <stdint.h>
#include <stddef.h>
#include <mach-o/loader.h>
#include "sigdb.h"

typedef struct {
    const char *name;
    uintptr_t   site;
} np_resolved_t;

typedef struct {
    np_resolved_t *items;
    int            used;
    int            cap;
} np_resolve_result_t;

// True when the 32-bit value at `addr` looks like a common AArch64 prologue.
int np_looks_like_prologue(uintptr_t addr);

// Resolve every signature in `sigdb` against the live image at `mh`+`slide`.
int np_resolve_signatures(const struct mach_header_64 *mh, intptr_t slide,
                      np_sigdb_t *sigdb, np_resolve_result_t *out);

uintptr_t np_lookup_address(const np_resolve_result_t *result, const char *name);
void      np_free_resolution(np_resolve_result_t *result);

#endif // NOTPROTON_RESOLVER_RESOLVER_H
