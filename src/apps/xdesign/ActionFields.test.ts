import { describe, expect, it } from "vitest";
import { photoFields, schemaFields } from "./ActionFields";

describe("action parameter controls",()=>{
  it("separates top-level controls from nested image-command structures",()=>{
    const fields=photoFields('{"source":{"channel":"red|green","layer":id},"matrix":[a,b,c,d,e,f],"width":px,"opacity":0..100=50,"visible":bool=true,"color":"#rrggbb","anchor":"left|center|right"="center"}');
    expect(fields.map(f=>f.key)).toEqual(["width","opacity","visible","color","anchor"]);expect(fields.find(f=>f.key==="opacity")).toMatchObject({min:0,max:100});expect(fields.at(-1)?.options).toEqual(["left","center","right"]);
  });
  it("does not treat commas or braces inside strings as additional fields",()=>{
    expect(photoFields('{"name":str?,"kind":"one,{a}|two"}').map(f=>f.key)).toEqual(["name","kind"]);
  });
  it("creates typed design controls while preserving complex values for the advanced editor",()=>{
    expect(schemaFields({properties:{width:{anyOf:[{type:"string"},{type:"number",minimum:1}]},name:{type:"string"},hidden:{type:"boolean"},mode:{enum:["A","B"]},fills:{type:"array"}}}).map(f=>[f.key,f.kind])).toEqual([["width","number"],["name","string"],["hidden","boolean"],["mode","enum"]]);
  });
  it("omits prototype properties from both parameter sources",()=>{
    expect(photoFields('{"__proto__":str,"constructor":str,"name":str}').map(f=>f.key)).toEqual(["name"]);
    expect(schemaFields(JSON.parse('{"properties":{"__proto__":{"type":"string"},"prototype":{"type":"string"}}}'))).toEqual([]);
  });
});
