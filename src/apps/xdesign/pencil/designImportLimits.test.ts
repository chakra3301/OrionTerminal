import { expect,it } from "vitest";
import { assertDesignImportSize,MAX_FIG_INPUT_BYTES } from "./designImportLimits";
it("rejects oversized authored fig imports before decoding while keeping the separate pen budget",()=>{
  expect(()=>assertDesignImportSize("Library.FIG",MAX_FIG_INPUT_BYTES+1)).toThrow("64MB");
  expect(()=>assertDesignImportSize("Library.fig",MAX_FIG_INPUT_BYTES)).not.toThrow();
  expect(()=>assertDesignImportSize("Library.pen",128*1024*1024)).not.toThrow();
  for(const bytes of [0,-1,NaN,Infinity,1.5])expect(()=>assertDesignImportSize("Library.fig",bytes)).toThrow();
});
