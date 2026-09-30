/** 左パネル: 種（基準楽器）とマイ楽器。クリックで読み込み＋試聴、ドラッグでブレンドの角へ。 */
import { useMemo, useState } from "react";
import { CATEGORIES, type Instrument } from "../engine/instrument";
import { SEEDS } from "../presets/seeds";
import { useStore } from "../state/store";
import { audition } from "./audition";
import { descriptorOf } from "./hooks";
import { Orb } from "./Orb";
import { cx, download } from "./util";
import { serialize } from "../engine/instrument";
import { safeName } from "../io/multisample";

export const DRAG_MIME = "application/x-atelier-id";

export function findInstrument(id: string): Instrument | undefined {
  return SEEDS.find((s) => s.id === id) ?? useStore.getState().library.find((l) => l.id === id);
}

export function Browser() {
  const [tab, setTab] = useState<"seeds" | "mine">("seeds");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const library = useStore((s) => s.library);
  const currentId = useStore((s) => s.inst.id);
  const load = useStore((s) => s.load);

  const items = useMemo(() => {
    const src = tab === "seeds" ? SEEDS : library;
    const qq = q.trim().toLowerCase();
    return src.filter((i) => {
      if (cat && i.meta.category !== cat) return false;
      if (!qq) return true;
      return [i.meta.name, i.meta.description ?? "", ...i.meta.tags].join(" ").toLowerCase().includes(qq);
    });
  }, [tab, q, cat, library]);

  const cats = CATEGORIES.filter((c) => (tab === "seeds" ? SEEDS : library).some((i) => i.meta.category === c.id));

  return (
    <aside className="browser" aria-label="楽器ブラウザ">
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === "seeds"} className={cx(tab === "seeds" && "on")} onClick={() => setTab("seeds")}>
          種 <span className="count">{SEEDS.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "mine"} className={cx(tab === "mine" && "on")} onClick={() => setTab("mine")}>
          マイ楽器 <span className="count">{library.length}</span>
        </button>
      </div>
      <input className="search" type="search" placeholder="名前・タグで探す" value={q} onChange={(e) => setQ(e.target.value)} aria-label="楽器を検索" />
      {cats.length > 1 && (
        <div className="chips">
          <button className={cx("chip", !cat && "on")} onClick={() => setCat(null)}>
            すべて
          </button>
          {cats.map((c) => (
            <button key={c.id} className={cx("chip", cat === c.id && "on")} onClick={() => setCat(cat === c.id ? null : c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <ul className="inst-list">
        {items.map((i) => (
          <li key={i.id}>
            <button
              className={cx("inst-row", currentId === i.id && "current")}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, i.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => {
                load(i);
                void audition(i);
              }}
              title={`${i.meta.description ?? ""}\nクリック: 読み込んで試聴 / ドラッグ: ブレンドの角へ`}
            >
              <Orb d={descriptorOf(i)} size={34} />
              <span className="inst-text">
                <span className="inst-name">{i.meta.name}</span>
                <span className="inst-sub">
                  {tab === "mine" && i.meta.lineage.length
                    ? i.meta.lineage.map((l) => l.name).join(" × ")
                    : i.meta.description ?? CATEGORIES.find((c) => c.id === i.meta.category)?.label}
                </span>
              </span>
            </button>
            {tab === "mine" && (
              <span className="row-actions">
                <button title="書き出し（.atelier）" aria-label={`${i.meta.name} を書き出し`} onClick={() => download(serialize(i), `${safeName(i.meta.name)}.atelier`, "application/json")}>
                  ⤓
                </button>
                <button
                  title="削除"
                  aria-label={`${i.meta.name} を削除`}
                  onClick={() => {
                    if (confirm(`「${i.meta.name}」をライブラリから削除しますか？`)) void useStore.getState().removeFromLibrary(i.id);
                  }}
                >
                  ×
                </button>
              </span>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="empty">{tab === "mine" ? "まだ保存した楽器はありません。音を作ったら上の「保存」で追加できます。" : "該当する種がありません"}</li>
        )}
      </ul>
    </aside>
  );
}
