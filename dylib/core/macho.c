#include "macho.h"
#include <mach-o/dyld.h>
#include <signal.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t g_await_stop;

void np_await_stop(void) {
    g_await_stop = 1;
}

static int image_index_by_name(const char *needle) {
    uint32_t n = _dyld_image_count();
    for (uint32_t idx = 0; idx < n; idx++) {
        const char *path = _dyld_get_image_name(idx);
        if (path && strstr(path, needle))
            return (int)idx;
    }
    return -1;
}

int np_await_image(const char *name, int timeout_ms,
                         const struct mach_header_64 **out_mh, intptr_t *out_slide,
                         char *out_path, size_t path_size) {
    for (int waited = 0; waited < timeout_ms; waited += 100) {
        if (g_await_stop) return -1;

        int idx = image_index_by_name(name);
        if (idx >= 0) {
            *out_mh    = (const struct mach_header_64 *)_dyld_get_image_header((uint32_t)idx);
            *out_slide = _dyld_get_image_vmaddr_slide((uint32_t)idx);
            if (out_path && path_size) {
                const char *p = _dyld_get_image_name((uint32_t)idx);
                size_t len = strlen(p);
                if (len >= path_size) len = path_size - 1;
                memcpy(out_path, p, len);
                out_path[len] = '\0';
            }
            return 0;
        }
        usleep(100000);
    }
    return -1;
}

int np_find_segment(const struct mach_header_64 *mh, intptr_t slide,
                   const char *segname, uintptr_t *out_base, size_t *out_size) {
    if (!mh || !segname) return -1;

    const uint8_t *cursor = (const uint8_t *)(mh + 1);
    uint32_t remaining = mh->ncmds;

    while (remaining--) {
        const struct load_command *lc = (const struct load_command *)cursor;
        if (lc->cmdsize < sizeof(*lc))
            return -1;   // corrupt or truncated
        if (lc->cmd == LC_SEGMENT_64) {
            const struct segment_command_64 *sc = (const struct segment_command_64 *)cursor;
            if (strncmp(sc->segname, segname, sizeof(sc->segname)) == 0) {
                *out_base = (uintptr_t)sc->vmaddr + (uintptr_t)slide;
                *out_size = (size_t)sc->vmsize;
                return 0;
            }
        }
        cursor += lc->cmdsize;
    }
    return -1;
}

int np_get_section_containing(const struct mach_header_64 *mh, intptr_t slide,
                             uintptr_t addr, uintptr_t *out_base,
                             size_t *out_size) {
    if (!mh || !out_base || !out_size) return -1;

    const uint8_t *cursor = (const uint8_t *)(mh + 1);
    uint32_t remaining = mh->ncmds;

    while (remaining--) {
        const struct load_command *lc = (const struct load_command *)cursor;
        if (lc->cmdsize < sizeof(*lc))
            return -1;   // corrupt or truncated
        if (lc->cmd == LC_SEGMENT_64) {
            const struct segment_command_64 *sc =
                (const struct segment_command_64 *)cursor;

            if (lc->cmdsize < sizeof(*sc) + sc->nsects * sizeof(struct section_64))
                return -1;

            const struct section_64 *sect = (const struct section_64 *)(sc + 1);
            for (uint32_t i = 0; i < sc->nsects; i++) {
                uintptr_t base = (uintptr_t)sect[i].addr + (uintptr_t)slide;
                if (addr < base || addr >= base + (uintptr_t)sect[i].size)
                    continue;
                *out_base = base;
                *out_size = (size_t)sect[i].size;
                return 0;
            }
        }
        cursor += lc->cmdsize;
    }
    return -1;
}
