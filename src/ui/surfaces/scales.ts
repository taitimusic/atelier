export const SCALES: { id: string; name: string; steps: number[] }[] = [
  { id: "major", name: "長音階", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "自然短音階", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", name: "ドリアン", steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", name: "ミクソリディアン", steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: "penta", name: "ペンタトニック（長）", steps: [0, 2, 4, 7, 9] },
  { id: "pentaMinor", name: "ペンタトニック（短）", steps: [0, 3, 5, 7, 10] },
  { id: "hirajoshi", name: "平調子（箏）", steps: [0, 2, 3, 7, 8] },
  { id: "kumoi", name: "雲井調子", steps: [0, 2, 3, 7, 9] },
  { id: "yo", name: "陽音階（民謡）", steps: [0, 2, 5, 7, 9] },
  { id: "ryukyu", name: "琉球音階", steps: [0, 4, 5, 7, 11] },
  { id: "blues", name: "ブルース", steps: [0, 3, 5, 6, 7, 10] },
  { id: "chromatic", name: "半音階", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const ROOTS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export function inScale(note: number, root: number, steps: number[]): boolean {
  return steps.includes((((note - root) % 12) + 12) % 12);
}
