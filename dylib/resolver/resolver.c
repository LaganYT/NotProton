// Signature resolver

#include "resolver.h"
#include "anchor.h"
#include "../core/macho.h"
#include "../util/log.h"

#include <stdlib.h>
#include <string.h>

// Prologue detection
static const struct { uint32_t mask, val; } prologue_forms[] = {
    { 0xFF0003FF, 0xD10003FF },  // SUB  SP, SP, #imm
    { 0xFFC07FFF, 0xA9007BFD },  // STP  x29, x30, [SP, #off]
    { 0xFFC07FFF, 0xA9807BFD },  // STP  x29, x30, [SP, #off]!
    { 0xFFFFFFFF, 0xD503237F },  // PACIBSP  (sign LR)
    { 0xFFFFFFFF, 0x910003FD },  // MOV  x29, SP
    { 0xFFC003E0, 0xA98003E0 },  // STP  Xt, Xt2, [SP, #off]!
    { 0xFFC003E0, 0xA90003E0 },  // STP  Xt, Xt2, [SP, #off]
};

int np_looks_like_prologue(uintptr_t addr) {
    if (!addr) return 0;
    uint32_t w = *(const uint32_t *)addr;
    for (int i = 0; i < (int)(sizeof(prologue_forms) / sizeof(prologue_forms[0])); i++) {
        if ((w & prologue_forms[i].mask) == prologue_forms[i].val)
            return 1;
    }
    return 0;
}

// Result accumulator
static void push(np_resolve_result_t *r, const char *name, uintptr_t addr) {
    if (r->used == r->cap) {
        int grown = r->cap ? r->cap * 2 : 32;
        np_resolved_t *buf = realloc(r->items, (size_t)grown * sizeof(*buf));
        if (!buf) return;
        r->items = buf;
        r->cap   = grown;
    }
    r->items[r->used++] = (np_resolved_t){ .name = name, .site = addr };
}

// Single-signature resolution
static uintptr_t try_anchor(np_sig_entry_t *sig,
                            const struct mach_header_64 *mh, intptr_t slide,
                            uintptr_t text, size_t text_sz) {
    if (sig->anchor.kind == NP_MATCH_NONE) return 0;
    uintptr_t addr = np_locate_anchor(mh, slide, text, text_sz, &sig->anchor);
    if (!addr) return 0;

    NP_LOG("resolver: '%s' -> 0x%lx [anchor]", sig->name, (unsigned long)addr);
    return addr;
}

// arm64 instructions are 4-byte aligned, so a misaligned or out-of-__TEXT
// address cannot be a hook site.
static int usable_code_address(const char *name, uintptr_t addr,
                               uintptr_t text, size_t text_sz) {
    if (addr & 3u) {
        NP_WARN("resolver: '%s' resolved to 0x%lx, not a 4-byte aligned "
                "instruction address; rejecting", name, (unsigned long)addr);
        return 0;
    }
    if (addr < text || addr > text + text_sz - sizeof(uint32_t)) {
        NP_WARN("resolver: '%s' resolved to 0x%lx, outside __TEXT "
                "0x%lx..0x%lx; rejecting", name, (unsigned long)addr,
                (unsigned long)text, (unsigned long)(text + text_sz));
        return 0;
    }
    return 1;
}

// Public API
int np_resolve_signatures(const struct mach_header_64 *mh, intptr_t slide,
                      np_sigdb_t *sigdb, np_resolve_result_t *out) {
    if (!mh || !sigdb || !out) return 0;
    memset(out, 0, sizeof(*out));

    uintptr_t text;
    size_t text_sz;
    if (np_find_segment(mh, slide, "__TEXT", &text, &text_sz) != 0) {
        NP_ERR("resolver: __TEXT segment not found, cannot scan");
        return 0;
    }

    NP_LOG("resolver: scanning __TEXT @ 0x%lx (%zu bytes) for %d signatures",
           text, text_sz, sigdb->sig_count);

    int resolved = 0;

    for (int i = 0; i < sigdb->sig_count; i++) {
        np_sig_entry_t *sig = &sigdb->signatures[i];

        if (sig->deprecated) {
            push(out, sig->name, 0);
            continue;
        }

        uintptr_t addr = try_anchor(sig, mh, slide, text, text_sz);

        if (addr && !usable_code_address(sig->name, addr, text, text_sz))
            addr = 0;

        if (addr)
            resolved++;

        push(out, sig->name, addr);
    }

    NP_LOG("resolver: %d/%d signatures resolved", resolved, sigdb->sig_count);
    return resolved;
}

uintptr_t np_lookup_address(const np_resolve_result_t *result, const char *name) {
    if (!result || !name) return 0;
    for (int i = 0; i < result->used; i++) {
        if (result->items[i].name && strcmp(result->items[i].name, name) == 0)
            return result->items[i].site;
    }
    return 0;
}

void np_free_resolution(np_resolve_result_t *result) {
    if (!result) return;
    free(result->items);
    memset(result, 0, sizeof(*result));
}
