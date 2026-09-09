"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventDraft } from "@/lib/event-draft";
import {
  allSeats,
  assignCategory,
  blockInputError,
  createBlock,
  emptySeatPlan,
  MAX_SEATS,
  planIssues,
  planTickets,
  readSeatPlan,
  reusablePlan,
  saleSeats,
  setBlocked,
  uid,
  venuePlanKey,
  type BlockInput,
  type PlanEditorDraft,
  type PlanBlock,
  type PlanCategory,
  type SeatPlanDraft,
} from "@/lib/seat-plan";
import {
  openPlanFile,
  readPlanFile,
  renderPlanPage,
  storePlanFile,
} from "@/lib/seat-plan-file";
import { seatPlansApi, type SavedSeatPlan } from "@/lib/api/seat-plans";
import { normalizeMoneyInput } from "@/lib/event-sales";
import { WizardFrame, WizardIcon } from "./event-wizard-layout";
import { SeatPlanCanvas } from "./seat-plan-canvas";
import styles from "./event-wizard.module.css";
import css from "./seat-plan.module.css";

type View =
  | "source"
  | "pages"
  | "overview"
  | "rows"
  | "arrange"
  | "select"
  | "block"
  | "unblock"
  | "review"
  | "category"
  | "saved"
  | "requirements"
  | "file-error"
  | "draft-saved";
const initialBlock: BlockInput = {
  name: "Parter",
  rows: 6,
  columns: 10,
  firstRow: "A",
  firstSeat: 1,
  aisle: 5,
  direction: "ltr",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function Card({
  title,
  children,
  error = false,
}: {
  title: string;
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={`${css.card} ${error ? css.error : ""}`}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function SeatPlanEditor({
  draft,
  updateDraft,
  save,
  onDone,
}: {
  draft: EventDraft;
  updateDraft: (draft: EventDraft) => void;
  save: (announce?: boolean) => boolean;
  onDone: () => void;
}) {
  const key = venuePlanKey(draft.schedule.venue);
  const [initial] = useState(() =>
    draft.sales.seatPlan?.venueKey === key
      ? draft.sales.seatPlan
      : emptySeatPlan(key),
  );
  const plan =
    draft.sales.seatPlan?.venueKey === key ? draft.sales.seatPlan : initial;
  const [view, setView] = useState<View>(
    plan.editorDraft?.view ??
      (plan.background || plan.blocks.length ? "overview" : "source"),
  );
  const [history, setHistory] = useState<View[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedPlans, setSavedPlans] = useState<SavedSeatPlan[]>([]);
  const [blockInput, setBlockInput] = useState<BlockInput>(
    plan.editorDraft?.blockInput ?? initialBlock,
  );
  const [editingId, setEditingId] = useState<string | undefined>(
    plan.editorDraft?.editingId,
  );
  const [activeBlock, setActiveBlock] = useState(plan.blocks[0]?.id || "");
  const [selected, setSelected] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState<PlanCategory>(
    plan.editorDraft?.category ?? {
      id: "",
      name: "",
      price: "",
      free: false,
    },
  );
  const [categoryRows, setCategoryRows] = useState<string[]>(
    plan.editorDraft?.categoryRows ?? [],
  );
  const persistEditorDraft = useEffectEvent(
    (editorDraft: PlanEditorDraft | undefined) => {
      updateDraft({
        ...draft,
        sales: { ...draft.sales, seatPlan: { ...plan, editorDraft } },
      });
    },
  );
  useEffect(() => {
    if (view === "draft-saved") return;
    persistEditorDraft(
      view === "rows" || view === "category"
        ? { view, blockInput, editingId, category, categoryRows }
        : undefined,
    );
  }, [view, blockInput, editingId, category, categoryRows]);
  const fileInput = useRef<HTMLInputElement>(null);
  const pdf = useRef<PDFDocumentProxy | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void pdf.current?.loadingTask.destroy();
    };
  }, []);
  const seats = allSeats(plan),
    selling = saleSeats(plan),
    blocked = seats.length - selling.length;
  const capacity =
    draft.schedule.venue?.capacity ?? (Number(draft.sales.capacity) || null);
  const issues = planIssues(plan, capacity);
  const rowOptions = plan.blocks.flatMap((b) =>
    [...new Set(b.seats.map((s) => s.row))].map((row) => ({
      key: `${b.id}:${row}`,
      name: `${b.name} · ${row}`,
    })),
  );
  const active =
    plan.blocks.find((b) => b.id === activeBlock) || plan.blocks[0];
  function update(next: SeatPlanDraft) {
    updateDraft({
      ...draft,
      sales: { ...draft.sales, seatPlan: next, seatPlanApplied: false },
    });
  }
  function go(next: View) {
    save(false);
    setError("");
    setNotice("");
    setHistory((h) => [...h, view]);
    setView(next);
  }
  function back() {
    if (busy) return;
    save(false);
    setError("");
    if (history.length) {
      setView(history.at(-1)!);
      setHistory((h) => h.slice(0, -1));
    } else onDone();
  }
  function overview() {
    setView("overview");
    setHistory([]);
    setSelected([]);
    setError("");
    save(false);
  }
  async function selectFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const result = await openPlanFile(file);
      if (!alive.current) {
        void result.pdf?.loadingTask.destroy();
        return;
      }
      await pdf.current?.loadingTask.destroy();
      pdf.current = result.pdf;
      const sourceId = uid();
      try {
        await storePlanFile(sourceId, file);
      } catch {
        setNotice(
          "Orijinal fayl bu brauzerdə saxlanılmadı. Seçilmiş səhifənin fonu qaralamada qalacaq.",
        );
      }
      update({
        ...plan,
        sourceId,
        sourceName: file.name.slice(0, 160),
        page: 1,
        pageCount: result.pages,
        background: result.image,
      });
      go("pages");
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Fayl açıla bilmir.");
        setView("file-error");
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function selectPage(page: number) {
    setBusy(true);
    setError("");
    try {
      if (!pdf.current) {
        const file = await readPlanFile(plan.sourceId);
        if (!file)
          throw new Error("Səhifəni dəyişmək üçün orijinal PDF-i yenidən seç.");
        const result = await openPlanFile(file);
        pdf.current = result.pdf;
      }
      if (!pdf.current) throw new Error("Bu fayl bir səhifəlik şəkildir.");
      const background = await renderPlanPage(pdf.current, page);
      if (alive.current) update({ ...plan, page, background });
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Səhifə açıla bilmir.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function openRows(block?: PlanBlock) {
    setEditingId(block?.id);
    setBlockInput(
      block
        ? { ...block }
        : {
            ...initialBlock,
            name: plan.blocks.length
              ? `Bölmə ${plan.blocks.length + 1}`
              : "Parter",
          },
    );
    go("rows");
  }
  function saveRows() {
    const invalid = blockInputError(blockInput);
    if (invalid) {
      setError(invalid);
      return;
    }
    const previous = plan.blocks.find((b) => b.id === editingId);
    const count =
      seats.length -
      (previous?.seats.length || 0) +
      blockInput.rows * blockInput.columns;
    if (count > MAX_SEATS || (capacity && count > capacity)) {
      setError(
        `Maksimum ${Math.min(MAX_SEATS, capacity || MAX_SEATS)} yer əlavə edilə bilər.`,
      );
      return;
    }
    const block = createBlock(blockInput, previous);
    if (!previous && plan.blocks.length) {
      block.x = 100;
      block.y = 150;
    }
    update({
      ...plan,
      name: plan.name || `${block.name} · Konsert düzülüşü`,
      blocks: previous
        ? plan.blocks.map((b) => (b.id === block.id ? block : b))
        : [...plan.blocks, block],
    });
    setActiveBlock(block.id);
    overview();
  }
  function editCategory(value?: PlanCategory) {
    const next = value || { id: uid(), name: "", price: "", free: false };
    setCategory({ ...next });
    setCategoryRows(
      value
        ? plan.blocks.flatMap((b) => [
            ...new Set(
              b.seats
                .filter((s) => s.categoryId === value.id)
                .map((s) => `${b.id}:${s.row}`),
            ),
          ])
        : [],
    );
    go("category");
  }
  function applyCategory() {
    if (!category.name.trim() || !categoryRows.length) {
      setError("Kateqoriya adını və ən azı bir sıranı seç.");
      return;
    }
    update(assignCategory(plan, category, categoryRows));
    setView("review");
    setHistory((h) => h.filter((v) => v !== "category"));
    setError("");
  }
  function rangeSelection() {
    if (!active) {
      return;
    }
    const start = active.seats.find(
        (s) => `${s.row}${s.number}` === rangeStart.toUpperCase(),
      ),
      end = active.seats.find(
        (s) => `${s.row}${s.number}` === rangeEnd.toUpperCase(),
      );
    if (!start || !end || start.row !== end.row) {
      setError("Eyni sırada mövcud ilk və son yeri seç (məsələn F9–F10).");
      return;
    }
    setSelected(
      active.seats
        .filter(
          (s) =>
            s.row === start.row &&
            s.number >= Math.min(start.number, end.number) &&
            s.number <= Math.max(start.number, end.number) &&
            !s.blocked,
        )
        .map((s) => s.id),
    );
    setError("");
  }
  async function loadSaved() {
    go("saved");
    setBusy(true);
    try {
      const result = await seatPlansApi.list(key);
      if (alive.current) setSavedPlans(result);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Planlar yüklənmədi.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function selectSaved(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await seatPlansApi.get(id);
      const layout = readSeatPlan(result.layout);
      if (!layout) throw new Error("Plan məlumatı açıla bilmir.");
      if (alive.current) {
        const next = { ...reusablePlan(layout), id: uid(), venueKey: key };
        update(next);
        setActiveBlock(next.blocks[0]?.id || "");
        overview();
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Plan açıla bilmir.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function applyPlan() {
    if (issues.length) {
      setError(issues[0]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await seatPlansApi.save(plan);
      if (!alive.current) return;
      updateDraft({
        ...draft,
        sales: {
          ...draft.sales,
          seatPlan: plan,
          seatPlanApplied: true,
          seatPlanSource: "custom",
          customPlanName: plan.name,
          tickets: planTickets(plan),
        },
      });
      if (!save(false)) {
        setError(
          "Plan hesabında saxlanıldı, amma tədbir qaralaması saxlanılmadı. Yenidən cəhd et.",
        );
        return;
      }
      onDone();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Plan saxlanılmadı. Yenidən cəhd et.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const headings: Record<View, [string, string]> = {
    source: [
      "Məkan planını qur",
      "Hazır planını seç və ya məkanın çertyojunu yüklə.",
    ],
    pages: [
      "Plan səhifəsini seç",
      `${plan.sourceName} · ${plan.pageCount} səhifə`,
    ],
    overview: [
      seats.length ? "Düzülüşü yoxla" : "Oturacaqları yerləşdir",
      seats.length
        ? `2. Düzülüş · ${seats.length} yer · ${selling.length} satış`
        : "1. Fon hazırdır · 2. Düzülüş · 3. Yoxlama",
    ],
    rows: ["Sıraları əlavə et", "Plan üzərində nömrəli yerlər yaranacaq."],
    arrange: ["Düzülüşü dəyiş", `Seçilmiş blok · ${active?.name || ""}`],
    select: [
      "Yerləri seç",
      "Yaxın görünüş · Yerlərə toxun və ya eyni sırada nömrə aralığı seç.",
    ],
    block: [
      `${selected.length} yer seçilib`,
      "Bu yerlər planın üzərində qalacaq, lakin bilet kimi satılmayacaq.",
    ],
    unblock: ["Bağlı yerləri aç", "Satışa qaytarmaq istədiyin yerləri seç."],
    review: [
      "Planı təsdiqlə",
      `3. Yoxlama · ${selling.length} yer satışa açılacaq`,
    ],
    category: [
      "Qiymət kateqoriyası",
      "Kateqoriyanı sıralara bağla və qiymətini təyin et.",
    ],
    saved: ["Məkanın planları", "Hazır düzülüşü seç, yalnız qiymətləri yoxla."],
    requirements: [
      "Faylı belə hazırla",
      "Aydın plan oturacaqları yerləşdirməyi asanlaşdırır.",
    ],
    "file-error": ["Fayl açıla bilmir", "Faylı yoxla və yenidən seç."],
    "draft-saved": [
      "Qaralama saxlanıldı",
      "Planı hazırlamağa qaldığın yerdən davam edə bilərsən.",
    ],
  };
  const [title, description] = headings[view];
  const actions: Record<View, [string, () => void, string, boolean?]> = {
    source: [
      "Faylı seç",
      () => fileInput.current?.click(),
      "Planı məkan üçün bir dəfə hazırlayırsan",
    ],
    pages: [
      "Bu səhifəni istifadə et",
      overview,
      "Oturacaqlar növbəti mərhələdədir",
      !plan.background,
    ],
    overview: [
      seats.length ? "Qiymət və yoxlamaya keç" : "Sıraları əlavə et",
      () => (seats.length ? go("review") : openRows()),
      "Seçilməmiş yerlər satışa açılacaq",
    ],
    rows: [
      `${blockInput.rows * blockInput.columns || 0} yeri yerləşdir`,
      saveRows,
      "Nömrələr və mövqelər birlikdə saxlanır",
    ],
    arrange: [
      "Düzülüşü saxla",
      overview,
      "Mövqelər və yer nömrələri birlikdə saxlanır",
    ],
    select: [
      `${selected.length} yeri seç`,
      () => go("block"),
      "Seçimdən sonra satışa bağlaya bilərsən",
      !selected.length,
    ],
    block: [
      `${selected.length} yeri satışa bağla`,
      () => {
        update(setBlocked(plan, selected, true, reason));
        overview();
      },
      "İstənilən vaxt yenidən aça bilərsən",
      !selected.length,
    ],
    unblock: [
      `${selected.length} yeri satışa aç`,
      () => {
        update(setBlocked(plan, selected, false));
        overview();
      },
      "Açılmış yerlərin qiyməti yenidən yoxlanacaq",
      !selected.length,
    ],
    review: [
      "Planı saxla və tətbiq et",
      () => void applyPlan(),
      "Satış və biletlər addımına qayıdacaqsan",
      issues.length > 0,
    ],
    category: [
      `${plan.blocks.flatMap((b) => b.seats.filter((s) => !s.blocked && categoryRows.includes(`${b.id}:${s.row}`))).length} yerə tətbiq et`,
      applyCategory,
      "Bütün satış yerlərinə bir kateqoriya verilməlidir",
    ],
    saved: [
      "Yeni plan yüklə",
      () => go("source"),
      "Planlar məkan üzrə saxlanılır",
    ],
    requirements: [
      "Fayl seçiminə qayıt",
      () => go("source"),
      "PDF fon kimi açılacaq",
    ],
    "file-error": [
      "Başqa fayl seç",
      () => fileInput.current?.click(),
      "PDF, PNG və JPG · maksimum 10 MB",
    ],
    "draft-saved": [
      "Redaktora qayıt",
      back,
      "Məlumatların bu brauzerdə saxlanılıb",
    ],
  };
  const [action, onAction, hint, disabled] = actions[view];
  return (
    <WizardFrame
      title="Oturacaq planı"
      subtitle="Satış və biletlər"
      onBack={back}
      onSave={() => {
        if (busy) return;
        if (save(false)) go("draft-saved");
        else
          setError(
            "Qaralama saxlanılmadı. Brauzerdə boş yer ayırıb yenidən cəhd et.",
          );
      }}
    >
      <div className={styles.form} onBlurCapture={() => save(false)}>
        <input
          className={styles.hiddenFile}
          ref={fileInput}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          aria-label="Oturacaq planı faylı"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void selectFile(file);
          }}
        />
        <div className={styles.content} aria-busy={busy} inert={busy}>
          <div className={styles.introduction}>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {view === "source" ? (
            <>
              <button
                className={styles.salesSettings}
                type="button"
                onClick={() => void loadSaved()}
              >
                <span className={styles.ticketIcon}>
                  <WizardIcon name="save" />
                </span>
                <span>
                  <strong>Saxlanmış planlarım</strong>
                  <small>Məkan üçün hazır düzülüşdən istifadə et</small>
                </span>
                <WizardIcon name="forward" />
              </button>
              <Card title="PDF və ya şəkil ilə başla">
                Fayl fon kimi açılır. Oturacaqları onun üzərində yerləşdirib
                təsdiqləyəcəksən.
              </Card>
              <button
                type="button"
                className={css.link}
                onClick={() => go("requirements")}
              >
                Fayl necə hazırlanmalıdır?
              </button>
              <p className={styles.hint}>
                PDF, PNG və JPG · Üstdən görünüş, aydın xətlər · maksimum 10 MB
              </p>
            </>
          ) : null}
          {view === "pages" ? (
            <>
              <div className={css.pages}>
                {Array.from({ length: plan.pageCount }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={busy}
                    aria-pressed={plan.page === i + 1}
                    onClick={() => void selectPage(i + 1)}
                  >
                    Səhifə {i + 1}
                  </button>
                ))}
              </div>
              <div className={css.card}>
                <strong>Səhifə {plan.page}</strong>
                {plan.background ? (
                  <Image
                    unoptimized
                    width={1400}
                    height={900}
                    className={css.preview}
                    src={plan.background}
                    alt={`Planın ${plan.page}-ci səhifəsi`}
                  />
                ) : null}
              </div>
              <p className={styles.hint}>
                Məkanın planı fon kimi istifadə olunacaq. Mövcud yerlər
                avtomatik biletə çevrilmir.
              </p>
              <button
                type="button"
                className={styles.addTicket}
                onClick={() => fileInput.current?.click()}
              >
                Başqa fayl seç
              </button>
            </>
          ) : null}
          {view === "overview" || view === "arrange" ? (
            <>
              <SeatPlanCanvas
                plan={plan}
                editing={view === "arrange"}
                activeBlock={active?.id}
                onSelectBlock={setActiveBlock}
                onBlock={(b) =>
                  update({
                    ...plan,
                    blocks: plan.blocks.map((old) =>
                      old.id === b.id ? b : old,
                    ),
                  })
                }
              />
              {view === "overview" ? (
                <>
                  {seats.length ? (
                    <>
                      <div className={styles.row}>
                        <button
                          className={styles.addTicket}
                          onClick={() => go("arrange")}
                        >
                          Düzülüşü dəyiş
                        </button>
                        <button
                          className={styles.addTicket}
                          onClick={() => {
                            setSelected([]);
                            go("select");
                          }}
                        >
                          Yerləri seç
                        </button>
                      </div>
                      {blocked ? (
                        <button
                          className={styles.addTicket}
                          onClick={() => {
                            setSelected([]);
                            go("unblock");
                          }}
                        >
                          {blocked} bağlı yeri aç
                        </button>
                      ) : null}
                      <button className={css.link} onClick={() => openRows()}>
                        Yeni bölmə əlavə et
                      </button>
                    </>
                  ) : (
                    <Card title="Tək-tək yer əlavə etməyə ehtiyac yoxdur">
                      Sıra sayını və hər sıradakı yer sayını seç. Düzülüşü sonra
                      dəyişə bilərsən.
                    </Card>
                  )}
                  <button className={css.link} onClick={() => go("pages")}>
                    Fon və səhifəni dəyiş
                  </button>
                </>
              ) : active ? (
                <>
                  <Field label="Bölmə">
                    <select
                      aria-label="Redaktə edilən bölmə"
                      value={active.id}
                      onChange={(e) => setActiveBlock(e.target.value)}
                    >
                      {plan.blocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className={styles.row}>
                    <Field label="Ölçü · %">
                      <input
                        aria-label="Blokun ölçüsü faizlə"
                        type="number"
                        min={10}
                        max={300}
                        value={Math.round(active.scale * 100)}
                        onChange={(e) =>
                          update({
                            ...plan,
                            blocks: plan.blocks.map((b) =>
                              b.id === active.id
                                ? {
                                    ...b,
                                    scale: Math.max(
                                      0.1,
                                      Math.min(3, Number(e.target.value) / 100),
                                    ),
                                  }
                                : b,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field label="Dönmə · °">
                      <input
                        aria-label="Dönmə"
                        type="number"
                        min={-180}
                        max={180}
                        value={active.rotation}
                        onChange={(e) =>
                          update({
                            ...plan,
                            blocks: plan.blocks.map((b) =>
                              b.id === active.id
                                ? {
                                    ...b,
                                    rotation: Math.max(
                                      -180,
                                      Math.min(180, Number(e.target.value)),
                                    ),
                                  }
                                : b,
                            ),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <button
                    className={styles.addTicket}
                    onClick={() => openRows(active)}
                  >
                    Sıra və yer sayını dəyiş
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          {view === "rows" ? (
            <>
              <Field label="Bölmənin adı">
                <input
                  aria-label="Bölmənin adı"
                  maxLength={120}
                  value={blockInput.name}
                  onChange={(e) =>
                    setBlockInput({ ...blockInput, name: e.target.value })
                  }
                />
              </Field>
              <div className={styles.row}>
                <Field label="Sıra sayı">
                  <input
                    aria-label="Sıra sayı"
                    type="number"
                    min={1}
                    max={100}
                    value={blockInput.rows || ""}
                    onChange={(e) =>
                      setBlockInput({
                        ...blockInput,
                        rows: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Hər sırada yer">
                  <input
                    aria-label="Hər sırada yer"
                    type="number"
                    min={1}
                    max={100}
                    value={blockInput.columns || ""}
                    onChange={(e) =>
                      setBlockInput({
                        ...blockInput,
                        columns: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <div className={styles.row}>
                <Field label="İlk sıra">
                  <input
                    aria-label="İlk sıra"
                    maxLength={3}
                    value={blockInput.firstRow}
                    onChange={(e) =>
                      setBlockInput({
                        ...blockInput,
                        firstRow: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </Field>
                <Field label="İlk yer">
                  <input
                    aria-label="İlk yer nömrəsi"
                    type="number"
                    min={1}
                    value={blockInput.firstSeat || ""}
                    onChange={(e) =>
                      setBlockInput({
                        ...blockInput,
                        firstSeat: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Keçid hansı yerdən sonra? (0 = yoxdur)">
                <input
                  aria-label="Keçid"
                  type="number"
                  min={0}
                  value={blockInput.aisle}
                  onChange={(e) =>
                    setBlockInput({
                      ...blockInput,
                      aisle: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Nömrələmə istiqaməti">
                <select
                  aria-label="Nömrələmə istiqaməti"
                  value={blockInput.direction}
                  onChange={(e) =>
                    setBlockInput({
                      ...blockInput,
                      direction: e.target.value as "ltr" | "rtl",
                    })
                  }
                >
                  <option value="ltr">Soldan sağa</option>
                  <option value="rtl">Sağdan sola</option>
                </select>
              </Field>
              <Card
                title={`${blockInput.rows} sıra × ${blockInput.columns} yer = ${blockInput.rows * blockInput.columns} oturacaq`}
              >
                Səhnəyə ən yaxın sıra {blockInput.firstRow} olacaq. Keçid üçün
                yerlərin arasında boşluq ayrılacaq.
              </Card>
            </>
          ) : null}
          {["select", "block", "unblock"].includes(view) && active ? (
            <>
              <Field label="Bölmə">
                <select
                  aria-label="Yer seçilən bölmə"
                  value={active.id}
                  onChange={(e) => {
                    setActiveBlock(e.target.value);
                    setSelected([]);
                  }}
                >
                  {plan.blocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className={`${css.card} ${css.detail}`}>
                <strong>{active.name}</strong>
                {[...new Set(active.seats.map((s) => s.row))].map((row) => (
                  <div key={row} className={css.seatRow}>
                    <strong>{row}</strong>
                    {active.seats
                      .filter((s) => s.row === row)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={css.seat}
                          aria-label={`${s.row}${s.number}${s.blocked ? " · Bağlı" : ""}`}
                          aria-pressed={selected.includes(s.id)}
                          data-blocked={s.blocked}
                          disabled={view === "unblock" ? !s.blocked : s.blocked}
                          onClick={() =>
                            setSelected((old) =>
                              old.includes(s.id)
                                ? old.filter((id) => id !== s.id)
                                : [...old, s.id],
                            )
                          }
                        >
                          {s.number}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
              {view === "select" ? (
                <>
                  <div className={styles.row}>
                    <Field label="İlk yer">
                      <input
                        aria-label="Aralığın ilk yeri"
                        placeholder="F9"
                        value={rangeStart}
                        onChange={(e) => setRangeStart(e.target.value)}
                      />
                    </Field>
                    <Field label="Son yer">
                      <input
                        aria-label="Aralığın son yeri"
                        placeholder="F10"
                        value={rangeEnd}
                        onChange={(e) => setRangeEnd(e.target.value)}
                      />
                    </Field>
                  </div>
                  <button className={styles.addTicket} onClick={rangeSelection}>
                    Aralıqdakı yerləri seç
                  </button>
                </>
              ) : view === "block" ? (
                <Field label="Bağlanma səbəbi (istəyə bağlı)">
                  <input
                    aria-label="Bağlanma səbəbi"
                    maxLength={160}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              ) : null}
              <p className={styles.hint}>{selected.length} yer seçilib</p>
            </>
          ) : null}
          {view === "review" ? (
            <>
              <Field label="Planın adı">
                <input
                  aria-label="Planın adı"
                  maxLength={160}
                  value={plan.name}
                  onChange={(e) => update({ ...plan, name: e.target.value })}
                />
              </Field>
              {plan.categories.map((c) => (
                <button
                  className={styles.ticketCard}
                  key={c.id}
                  onClick={() => editCategory(c)}
                >
                  <span className={styles.ticketMain}>
                    <strong>{c.name}</strong>
                    <small>
                      {selling.filter((s) => s.categoryId === c.id).length}{" "}
                      satış yeri
                    </small>
                  </span>
                  <span>
                    {c.free
                      ? "Pulsuz"
                      : c.price
                        ? `${c.price} ₼`
                        : "Qiymət yoxdur"}
                  </span>
                </button>
              ))}
              <button
                className={styles.addTicket}
                disabled={plan.categories.length >= 20}
                onClick={() => editCategory()}
              >
                Qiymət kateqoriyası əlavə et
              </button>
              {issues.map((issue) => (
                <Card key={issue} title={issue} error>
                  Digər məlumatların saxlanılıb. Məlumatı tamamlayıb yenidən
                  yoxla.
                </Card>
              ))}
              {!issues.length ? (
                <Card
                  title={`${seats.length} yer = ${selling.length} satış + ${blocked} bağlı`}
                >
                  Nömrələr unikaldır. Satış yerlərinin hamısına qiymət təyin
                  edilib.
                </Card>
              ) : null}
              <p className={css.check}>Plan məkan üçün saxlanacaq</p>
              <p className={styles.hint}>
                Növbəti tədbirdə düzülüşü seçəcəksən. Qiymətlər bu tədbirə
                aiddir.
              </p>
            </>
          ) : null}
          {view === "category" ? (
            <>
              <Field label="Kateqoriyanın adı">
                <input
                  aria-label="Kateqoriyanın adı"
                  maxLength={80}
                  value={category.name}
                  onChange={(e) =>
                    setCategory({ ...category, name: e.target.value })
                  }
                />
              </Field>
              <fieldset className={css.card}>
                <legend>Sıralar</legend>
                <div className={css.rowChoices}>
                  {rowOptions.map((row) => (
                    <label key={row.key}>
                      <input
                        type="checkbox"
                        checked={categoryRows.includes(row.key)}
                        onChange={(e) =>
                          setCategoryRows((old) =>
                            e.target.checked
                              ? [...old, row.key]
                              : old.filter((k) => k !== row.key),
                          )
                        }
                      />
                      {row.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={css.check}>
                <input
                  type="checkbox"
                  checked={category.free}
                  onChange={(e) =>
                    setCategory({ ...category, free: e.target.checked })
                  }
                />
                Pulsuz
              </label>
              {!category.free ? (
                <Field label="Qiymət · AZN">
                  <input
                    aria-label="Kateqoriyanın qiyməti"
                    inputMode="decimal"
                    value={category.price}
                    onChange={(e) =>
                      setCategory({
                        ...category,
                        price: normalizeMoneyInput(e.target.value),
                      })
                    }
                  />
                </Field>
              ) : null}
              <Card title="Qiymət seçilmiş sıralara tətbiq olunur">
                Bağlı yerlər satış sayına daxil edilmir. Açıldıqda həmin sıranın
                kateqoriyasından istifadə olunur.
              </Card>
            </>
          ) : null}
          {view === "saved" ? (
            <>
              {savedPlans.map((p) => (
                <button
                  key={p.id}
                  className={styles.salesSettings}
                  disabled={busy}
                  onClick={() => void selectSaved(p.id)}
                >
                  <span className={styles.ticketIcon}>
                    <WizardIcon name="save" />
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.seat_count} yer · {p.seat_count - p.blocked_count}{" "}
                      satış · {p.blocked_count} bağlı
                    </small>
                  </span>
                  <WizardIcon name="forward" />
                </button>
              ))}
              {!busy && !savedPlans.length && !error ? (
                <Card title="Hələ saxlanmış plan yoxdur">
                  Bu məkan üçün ilk planını yüklə və oturacaqları yerləşdir.
                </Card>
              ) : null}
              {error ? (
                <button
                  className={styles.addTicket}
                  onClick={() => void loadSaved()}
                >
                  Yenidən cəhd et
                </button>
              ) : null}
              <Card title="Nömrələri yenidən qurmağa ehtiyac yoxdur">
                Bölmələr, sıralar və yerləşmə hazır gəlir. Qiymətləri hər tədbir
                üçün ayrıca təyin edirsən.
              </Card>
            </>
          ) : null}
          {view === "requirements" ? (
            <>
              <Card title="PDF, PNG və JPG">
                PDF üçün vektor ixracı daha uyğundur. DWG və DXF faylını əvvəlcə
                PDF-ə çevir.
              </Card>
              <Card title="Üstdən görünüş və aydın xətlər">
                Səhnə, divarlar və girişlər görünsün. A4 və ya A3 məcburi deyil.
              </Card>
              <Card title="Bir zal üçün uyğun səhifəni seç">
                Memarlıq planında oturacaqlar yoxdursa, onları redaktorda özün
                yerləşdirəcəksən.
              </Card>
            </>
          ) : null}
          {view === "file-error" ? (
            <Card title="Faylı yenidən ixrac et">
              Şifrəsiz PDF, PNG və ya JPG seç. Faylın ölçüsü 10 MB-dan çox
              olmamalıdır. Hazırkı düzülüşün qorunur.
            </Card>
          ) : null}
          {view === "draft-saved" ? (
            <Card title="Qaralama saxlanıldı">
              Fon, düzülüş və qiymətlər bu brauzerdə qorunur. Plan hələ satışa
              tətbiq edilməyib.
            </Card>
          ) : null}
          {busy ? (
            <p role="status" className={styles.hint}>
              Gözlə…
            </p>
          ) : null}
          {notice ? (
            <p role="status" className={styles.hint}>
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className={styles.timeError}>
              {error}
            </p>
          ) : null}
        </div>
        <footer className={styles.footer}>
          <button
            className={styles.next}
            type="button"
            disabled={busy || disabled}
            onClick={onAction}
          >
            {busy ? "Gözlə…" : action}
          </button>
          <p>{hint}</p>
        </footer>
      </div>
    </WizardFrame>
  );
}
