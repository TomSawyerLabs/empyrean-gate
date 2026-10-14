// Empyrean's view into DOOM's globals, compiled alongside the vendored
// doomgeneric sources (see README.md in this directory). Everything the Rust
// host needs that doomgeneric's five DG_* callbacks do not provide lives
// here, so the Rust side never has to mirror a C struct layout it does not
// own: the current palette (CMAP256 build), the player's HUD numbers, and the
// stdout hand-off that keeps DOOM's printf chatter off the frame pipe.

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#define dg_dup _dup
#define dg_dup2 _dup2
#else
#include <unistd.h>
#define dg_dup dup
#define dg_dup2 dup2
#endif

#include "doomgeneric/doomstat.h"
#include "doomgeneric/d_player.h"
#include "doomgeneric/d_items.h"
#include "doomgeneric/i_video.h"

// Mirrors `host::RawStats` in Rust field for field (all int32, in this
// order). Keep both in step: the host sends it on the wire as-is.
typedef struct dg_stats {
    int32_t health;
    int32_t armor;
    int32_t ammo;       // -1 when the ready weapon needs none (fist, chainsaw)
    int32_t max_ammo;   // -1 likewise
    int32_t weapon;     // weapontype_t: 0 fist .. 8 chainsaw
    int32_t kills;
    int32_t total_kills;
    int32_t items;
    int32_t secrets;
    int32_t episode;
    int32_t map;
    int32_t state;      // gamestate_t: 0 level, 1 intermission, 2 finale, 3 demo
    int32_t menu;       // menu overlaid
    int32_t paused;
    int32_t leveltime;  // tics (35/s) into the current map
} dg_stats_t;

void dg_stats(dg_stats_t *out)
{
    const player_t *p = &players[consoleplayer];
    ammotype_t ammo_kind;

    memset(out, 0, sizeof(*out));
    out->health = p->health;
    out->armor = p->armorpoints;
    out->weapon = (int32_t)p->readyweapon;
    ammo_kind = weaponinfo[p->readyweapon].ammo;
    if (ammo_kind == am_noammo) {
        out->ammo = -1;
        out->max_ammo = -1;
    } else {
        out->ammo = p->ammo[ammo_kind];
        out->max_ammo = p->maxammo[ammo_kind];
    }
    out->kills = p->killcount;
    out->total_kills = totalkills;
    out->items = p->itemcount;
    out->secrets = p->secretcount;
    out->episode = gameepisode;
    out->map = gamemap;
    out->state = (int32_t)gamestate;
    out->menu = menuactive ? 1 : 0;
    out->paused = paused ? 1 : 0;
    out->leveltime = leveltime;
}

// The 256-entry palette DOOM is currently drawing with (gamma applied), as
// 768 bytes of R, G, B. Only meaningful in the CMAP256 build, which is the
// only build this tree is compiled in.
void dg_palette(uint8_t *out768)
{
    int i;
    for (i = 0; i < 256; i++) {
        out768[i * 3 + 0] = (uint8_t)colors[i].r;
        out768[i * 3 + 1] = (uint8_t)colors[i].g;
        out768[i * 3 + 2] = (uint8_t)colors[i].b;
    }
}

// DOOM prints progress to stdout and that is the host's frame pipe. Move the
// C runtime's fd 1 onto stderr and hand back a duplicate of the original so
// the host can keep writing frames to it. Returns -1 on failure.
int dg_steal_stdout(void)
{
    int frames = dg_dup(1);
    if (frames < 0) {
        return -1;
    }
    fflush(stdout);
    if (dg_dup2(2, 1) < 0) {
        return -1;
    }
    setvbuf(stdout, NULL, _IONBF, 0);
    return frames;
}

// The OS handle behind a CRT file descriptor: a HANDLE on Windows (so Rust can
// wrap it in a File), the fd itself elsewhere.
intptr_t dg_os_handle(int fd)
{
#ifdef _WIN32
    return (intptr_t)_get_osfhandle(fd);
#else
    return (intptr_t)fd;
#endif
}
