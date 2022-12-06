import * as autocmd from "https://deno.land/x/denops_std@v3.9.3/autocmd/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v3.9.3/helper/mod.ts";
import * as op from "https://deno.land/x/denops_std@v3.9.3/option/mod.ts";
import * as vars from "https://deno.land/x/denops_std@v3.9.3/variable/mod.ts";
import * as _ from "https://cdn.skypack.dev/lodash@4.17.21";
import type { Denops } from "https://deno.land/x/denops_std@v3.9.3/mod.ts";
import { Lock } from "https://deno.land/x/async@v1.2.0/mod.ts";
import { merge } from "https://cdn.skypack.dev/lodash@4.17.21";
import {
  assertBoolean,
  assertNumber,
} from "https://deno.land/x/unknownutil@v2.1.0/mod.ts";

const lineWait = 100;
const columnWait = 100;

type LineOrColumn = "cursorline" | "cursorcolumn";

type Event = {
  name: autocmd.AutocmdEvent;
  set: boolean;
  wait: number;
};

type Cursor = {
  enable: boolean;
  option: LineOrColumn;
  state: boolean;
  events: Event[];
};

let cfgLine: Cursor = {
  enable: true,
  option: "cursorline",
  state: false,
  events: [
    {
      name: "CursorHold",
      set: true,
      wait: lineWait,
    },
    {
      name: "CursorHoldI",
      set: true,
      wait: lineWait,
    },
    {
      name: "WinEnter",
      set: true,
      wait: 0,
    },
    {
      name: "BufEnter",
      set: true,
      wait: 0,
    },
    {
      name: "CursorMoved",
      set: false,
      wait: 0,
    },
    {
      name: "CursorMovedI",
      set: false,
      wait: 0,
    },
  ],
};
let cfgColumn: Cursor = {
  enable: true,
  option: "cursorcolumn",
  state: false,
  events: [
    {
      name: "CursorHold",
      set: true,
      wait: columnWait,
    },
    {
      name: "CursorHoldI",
      set: true,
      wait: columnWait,
    },
    {
      name: "WinEnter",
      set: true,
      wait: 0,
    },
    {
      name: "BufEnter",
      set: true,
      wait: 0,
    },
    {
      name: "CursorMoved",
      set: false,
      wait: 0,
    },
    {
      name: "CursorMovedI",
      set: false,
      wait: 0,
    },
  ],
};

let blacklistFileTypes = ["list"];

const lock = new Lock();

export async function main(denops: Denops): Promise<void> {
  // debug.
  const debug = await vars.g.get(denops, "autocursor_debug", false);
  // fix state interval.
  const fixInterval = await vars.g.get(denops, "autocursor_fix_interval", 5000);
  // throttle.
  const throttleTime = await vars.g.get(denops, "autocursor_throttle", 1000);
  // deno-lint-ignore no-explicit-any
  const clog = (...data: any[]): void => {
    if (debug) {
      console.log(...data);
    }
  };

  // Merge user option.
  const userCfgLine =
    (await vars.g.get(denops, "autocursor_cursorline")) as Cursor;
  const userCfgColumn =
    (await vars.g.get(denops, "autocursor_cursorcolumn")) as Cursor;
  blacklistFileTypes = await vars.g.get(
    denops,
    "autocursor_blacklist_filetypes",
    blacklistFileTypes,
  );

  cfgLine = merge(cfgLine, userCfgLine);
  cfgColumn = merge(cfgColumn, userCfgColumn);
  clog({
    debug,
    fixInterval,
    throttleTime,
    cfgLine,
    cfgColumn,
    blacklistFileTypes,
  });

  denops.dispatcher = {
    async setOption(
      set: unknown,
      wait: unknown,
      option: unknown,
    ): Promise<void> {
      try {
        await lock.with(_.throttle(() => {
          assertNumber(wait);
          assertBoolean(set);
          const opt = option as LineOrColumn;
          if (opt === "cursorline") {
            if (set === cfgLine.state || !cfgLine.enable) {
              clog(
                `setOption: cfgLine.state: ${cfgLine.state}, cfgLine.enable: ${cfgLine.enable} so return.`,
              );
              return;
            }
          }
          if (opt === "cursorcolumn") {
            if (set === cfgColumn.state || !cfgColumn.enable) {
              clog(
                `setOption: cfgColumn.state: ${cfgColumn.state}, cfgColumn.enable: ${cfgColumn.enable} so return.`,
              );
              return;
            }
          }
          setTimeout(async () => {
            const ft = (await op.filetype.get(denops));
            if (blacklistFileTypes.some((x) => x === ft)) {
              clog(`ft is [${ft}], so skip !`);
              return;
            }
            if (opt === "cursorline") {
              cfgLine.state = set;
            }
            if (opt === "cursorcolumn") {
              cfgColumn.state = set;
            }
            if (set) {
              clog(`setOption: set ${option}`);
              await op[opt].set(denops, true);
            } else {
              clog(`setOption: set no${option}`);
              await op[opt].set(denops, false);
            }
          }, wait);
        }, throttleTime));
      } catch (e) {
        clog(e);
      }
    },

    async changeCursor(enable: unknown, option: unknown): Promise<void> {
      assertBoolean(enable);
      const opt = option as LineOrColumn;
      if (!enable) {
        clog(`set no${opt}`);
        await op[opt].set(denops, false);
      }
      if (opt === "cursorline") {
        cfgLine.enable = enable;
      }
      if (opt === "cursorcolumn") {
        cfgColumn.enable = enable;
      }
    },

    // deno-lint-ignore require-await
    async fixState(interval: unknown): Promise<void> {
      assertNumber(interval);
      setInterval(async () => {
        cfgLine.state = (await op.cursorline.get(denops)) ? true : false;
        cfgColumn.state = (await op.cursorcolumn.get(denops)) ? true : false;
        clog(
          `Fix state. line: [${cfgLine.state}], column: [${cfgColumn.state}]`,
        );
      }, interval);
    },
  };

  await helper.execute(
    denops,
    `
    function! s:${denops.name}_notify(method, params) abort
      call denops#plugin#wait_async('${denops.name}', function('denops#notify', ['${denops.name}', a:method, a:params]))
    endfunction
    command! EnableAutoCursorLine call s:${denops.name}_notify('changeCursor', [v:true, "cursorline"])
    command! EnableAutoCursorColumn call s:${denops.name}_notify('changeCursor', [v:true, "cursorcolumn"])
    command! DisableAutoCursorLine call s:${denops.name}_notify('changeCursor', [v:false, "cursorline"])
    command! DisableAutoCursorColumn call s:${denops.name}_notify('changeCursor', [v:false, "cursorcolumn"])
  `,
  );

  await autocmd.group(denops, "autocursor", (helper) => {
    helper.remove();
    [cfgLine, cfgColumn].forEach((cfg) => {
      cfg.events.forEach((e) => {
        helper.define(
          e.name,
          "*",
          `call s:${denops.name}_notify('setOption', [${
            e.set ? "v:true" : "v:false"
          }, ${e.wait}, '${cfg.option}'])`,
        );
      });
    });
    helper.define(
      `User`,
      `DenopsPluginPost:${denops.name}`,
      `call s:${denops.name}_notify('fixState', [${fixInterval}])`,
    );
  });

  clog("dps-autocursor has loaded");
}
