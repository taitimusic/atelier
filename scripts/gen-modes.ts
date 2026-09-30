import { computeFamilies } from "../src/engine/modesCompute.ts";
const fams = computeFamilies();
const body = fams.map((f) => `  ${f.id}: [${Array.from(f.ratios).map((r) => +r.toFixed(5)).join(", ")}],`).join("\n");
console.log(`// 自動生成: scripts/gen-modes.ts（modesCompute.ts の物理式から計算。modes.test.ts で再計算と照合）\nexport const MODE_TABLE = {\n${body}\n} as const;\n`);
