"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scoreBucket, type NeutralPair } from "@/lib/scoring";
import { SITE_HOSTNAME, SITE_URL } from "@/lib/site";
import { vendorById, vendors, type Bucket, type Vendor } from "@/lib/vendors";

type Phase = "landing" | "bucket" | "compare" | "dish" | "results";
type BucketMap = Record<Bucket, string[]>;

type SortMachine = {
  bucket: Bucket;
  remainingBuckets: Bucket[];
  runs: string[][];
  mergedRuns: string[][];
  left: string[] | null;
  right: string[] | null;
  leftIndex: number;
  rightIndex: number;
  output: string[];
};

type ComparisonSnapshot = {
  machine: SortMachine;
  sorted: BucketMap;
  comparisons: number;
  neutralPairs: NeutralPair[];
};

type LeaderboardEntry = {
  vendorId: string;
  averageScore: number;
  ratingCount: number;
  favoriteDish?: string;
};

type LeaderboardResponse = {
  completionCount: number;
  uniqueVisitorCount?: number;
  entries: LeaderboardEntry[];
  mode?: "live" | "demo";
};

const emptyBuckets = (): BucketMap => ({ liked: [], fine: [], disliked: [] });
const bucketOrder: Bucket[] = ["liked", "fine", "disliked"];
const leaderboardUnlockCount = 5;
const leaderboardSharingGoal = 25;
const bucketShuffleSeeds: Record<Bucket, number> = {
  liked: 0x9e3779b9,
  fine: 0x85ebca6b,
  disliked: 0xc2b2ae35,
};

const bucketMeta: Record<Bucket, { label: string; mark: string }> = {
  liked: { label: "Liked", mark: "↑" },
  fine: { label: "Fine", mark: "—" },
  disliked: { label: "Disliked", mark: "↓" },
};

function shuffleWithSeed<T>(items: readonly T[], seed: number) {
  const shuffled = [...items];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function createSessionSeed() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

function createSortMachine(bucket: Bucket, items: string[], remainingBuckets: Bucket[]): SortMachine {
  return {
    bucket,
    remainingBuckets,
    runs: items.map((item) => [item]),
    mergedRuns: [],
    left: null,
    right: null,
    leftIndex: 0,
    rightIndex: 0,
    output: [],
  };
}

function advanceMachine(machine: SortMachine): { machine?: SortMachine; completed?: string[] } {
  let next = { ...machine };

  while (!next.left || !next.right) {
    if (next.runs.length >= 2) {
      const [left, right, ...rest] = next.runs;
      return {
        machine: {
          ...next,
          runs: rest,
          left,
          right,
          leftIndex: 0,
          rightIndex: 0,
          output: [],
        },
      };
    }

    if (next.runs.length === 1) {
      next = { ...next, mergedRuns: [...next.mergedRuns, next.runs[0]], runs: [] };
    }

    if (next.runs.length === 0) {
      if (next.mergedRuns.length === 1) return { completed: next.mergedRuns[0] };
      next = { ...next, runs: next.mergedRuns, mergedRuns: [] };
    }
  }

  return { machine: next };
}

function VendorArt({ vendor, compact = false }: { vendor: Vendor; compact?: boolean }) {
  return (
    <div
      className={`vendor-art${compact ? " vendor-art--compact" : ""}`}
      style={{ "--vendor": vendor.accent, "--vendor-soft": vendor.accentSoft } as React.CSSProperties}
      aria-hidden="true"
    >
      <Image
        className="vendor-art__image"
        src={vendor.image}
        alt=""
        fill
        loading="eager"
        unoptimized
        sizes={compact ? "48px" : "(max-width: 760px) calc(100vw - 58px), 430px"}
      />
    </div>
  );
}

function drawWrappedCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  lines.slice(0, 2).forEach((value, index) => context.fillText(value, x, y + index * lineHeight, maxWidth));
  return Math.min(lines.length, 2);
}

async function loadCanvasImage(src: string) {
  const image = new window.Image();
  image.decoding = "async";
  image.src = src;

  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Could not load ${src}`));
    });
  }

  if (!image.naturalWidth) throw new Error(`Could not load ${src}`);
  return image;
}

function drawRoundedCanvasImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  context.save();
  context.beginPath();
  context.roundRect(x, y, size, size, radius);
  context.clip();
  context.drawImage(image, x, y, size, size);
  context.restore();
}

function AppHeader({ step }: { step: string }) {
  return (
    <header className="app-header">
      <span className="step-label">{step}</span>
    </header>
  );
}

export function RankingApp() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [sessionSeed, setSessionSeed] = useState(0);
  const [vendorOrder, setVendorOrder] = useState<Vendor[]>(() => [...vendors]);
  const [bucketIndex, setBucketIndex] = useState(0);
  const [buckets, setBuckets] = useState<BucketMap>(emptyBuckets);
  const [comparisonBuckets, setComparisonBuckets] = useState<BucketMap>(emptyBuckets);
  const [sorted, setSorted] = useState<BucketMap>(emptyBuckets);
  const [machine, setMachine] = useState<SortMachine | null>(null);
  const [comparisons, setComparisons] = useState(0);
  const [comparisonHistory, setComparisonHistory] = useState<ComparisonSnapshot[]>([]);
  const [neutralPairs, setNeutralPairs] = useState<NeutralPair[]>([]);
  const [favoriteDish, setFavoriteDish] = useState<string | null>(null);
  const [favoriteDraft, setFavoriteDraft] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const savedSignature = useRef<string | null>(null);

  useEffect(() => {
    void fetch("/api/visitor", { method: "POST" }).catch(() => undefined);
  }, []);

  const scoredRanking = useMemo(() => {
    return bucketOrder.flatMap((bucket) =>
      scoreBucket(bucket, sorted[bucket], neutralPairs).map((result) => ({
        ...result,
        bucket,
        vendor: vendorById[result.vendorId],
      })),
    );
  }, [neutralPairs, sorted]);

  const topVendor = scoredRanking[0]?.vendor;
  const topScoreTieCount = scoredRanking.filter(({ score }) => score === scoredRanking[0]?.score).length;

  const reset = useCallback(() => {
    setPhase("landing");
    setSessionSeed(0);
    setVendorOrder([...vendors]);
    setBucketIndex(0);
    setBuckets(emptyBuckets());
    setComparisonBuckets(emptyBuckets());
    setSorted(emptyBuckets());
    setMachine(null);
    setComparisons(0);
    setComparisonHistory([]);
    setNeutralPairs([]);
    setFavoriteDish(null);
    setFavoriteDraft("");
    setShareStatus(null);
  }, []);

  function startRanking() {
    const seed = createSessionSeed();
    setSessionSeed(seed);
    setVendorOrder(shuffleWithSeed(vendors, seed));
    setPhase("bucket");
  }

  const beginComparisons = useCallback((finalBuckets: BucketMap) => {
    const shuffledBuckets: BucketMap = {
      liked: shuffleWithSeed(finalBuckets.liked, sessionSeed ^ bucketShuffleSeeds.liked),
      fine: shuffleWithSeed(finalBuckets.fine, sessionSeed ^ bucketShuffleSeeds.fine),
      disliked: shuffleWithSeed(finalBuckets.disliked, sessionSeed ^ bucketShuffleSeeds.disliked),
    };
    const sortable = bucketOrder.filter((bucket) => shuffledBuckets[bucket].length >= 2);
    setComparisonHistory([]);
    setNeutralPairs([]);
    setComparisonBuckets(shuffledBuckets);
    setSorted({
      liked: [...shuffledBuckets.liked],
      fine: [...shuffledBuckets.fine],
      disliked: [...shuffledBuckets.disliked],
    });

    if (bucketOrder.every((bucket) => finalBuckets[bucket].length === 0)) {
      setPhase("results");
      return;
    }

    if (sortable.length === 0) {
      setPhase("dish");
      return;
    }

    const [first, ...remaining] = sortable;
    const started = advanceMachine(createSortMachine(first, shuffledBuckets[first], remaining));
    setMachine(started.machine ?? null);
    setPhase("compare");
  }, [sessionSeed]);

  function chooseBucket(choice: Bucket | "untried") {
    const vendor = vendorOrder[bucketIndex];
    let nextBuckets = buckets;

    if (choice !== "untried") {
      nextBuckets = { ...buckets, [choice]: [...buckets[choice], vendor.id] };
      setBuckets(nextBuckets);
    }

    if (bucketIndex === vendorOrder.length - 1) {
      beginComparisons(nextBuckets);
    } else {
      setBucketIndex((current) => current + 1);
    }
  }

  function undoBucketChoice() {
    if (bucketIndex === 0) {
      setPhase("landing");
      return;
    }
    const previousVendor = vendorOrder[bucketIndex - 1];
    setBuckets((current) => ({
      liked: current.liked.filter((id) => id !== previousVendor.id),
      fine: current.fine.filter((id) => id !== previousVendor.id),
      disliked: current.disliked.filter((id) => id !== previousVendor.id),
    }));
    setBucketIndex((current) => current - 1);
  }

  function chooseComparison(preferredId: string | null) {
    if (!machine?.left || !machine.right) return;

    setComparisonHistory((current) => [...current, { machine, sorted, comparisons, neutralPairs }]);

    let leftIndex = machine.leftIndex;
    let rightIndex = machine.rightIndex;
    const leftId = machine.left[leftIndex];
    const rightId = machine.right[rightIndex];
    let output: string[];

    if (preferredId === null) {
      output = [...machine.output, leftId, rightId];
      leftIndex += 1;
      rightIndex += 1;
      setNeutralPairs((current) => [...current, [leftId, rightId]]);
    } else {
      output = [...machine.output, preferredId];
      if (leftId === preferredId) leftIndex += 1;
      else rightIndex += 1;
    }

    setComparisons((current) => current + 1);

    if (leftIndex < machine.left.length && rightIndex < machine.right.length) {
      setMachine({ ...machine, leftIndex, rightIndex, output });
      return;
    }

    const merged = [
      ...output,
      ...machine.left.slice(leftIndex),
      ...machine.right.slice(rightIndex),
    ];
    const advanced = advanceMachine({
      ...machine,
      mergedRuns: [...machine.mergedRuns, merged],
      left: null,
      right: null,
      leftIndex: 0,
      rightIndex: 0,
      output: [],
    });

    if (advanced.machine) {
      setMachine(advanced.machine);
      return;
    }

    const completed = advanced.completed ?? merged;
    const nextSorted = { ...sorted, [machine.bucket]: completed };
    setSorted(nextSorted);

    const [nextBucket, ...remainingBuckets] = machine.remainingBuckets;
    if (nextBucket) {
      const nextMachine = advanceMachine(createSortMachine(nextBucket, comparisonBuckets[nextBucket], remainingBuckets));
      setMachine(nextMachine.machine ?? null);
    } else {
      setMachine(null);
      setPhase("dish");
    }
  }

  function returnToBuckets() {
    const lastVendor = vendorOrder[vendorOrder.length - 1];
    setBuckets((current) => ({
      liked: current.liked.filter((id) => id !== lastVendor.id),
      fine: current.fine.filter((id) => id !== lastVendor.id),
      disliked: current.disliked.filter((id) => id !== lastVendor.id),
    }));
    setBucketIndex(vendorOrder.length - 1);
    setSorted(emptyBuckets());
    setComparisonBuckets(emptyBuckets());
    setMachine(null);
    setComparisons(0);
    setComparisonHistory([]);
    setNeutralPairs([]);
    setFavoriteDish(null);
    setFavoriteDraft("");
    setPhase("bucket");
  }

  function undoComparison() {
    const previous = comparisonHistory[comparisonHistory.length - 1];
    if (!previous) {
      returnToBuckets();
      return;
    }

    setMachine(previous.machine);
    setSorted(previous.sorted);
    setComparisons(previous.comparisons);
    setNeutralPairs(previous.neutralPairs);
    setComparisonHistory((current) => current.slice(0, -1));
    setFavoriteDish(null);
    setFavoriteDraft("");
    setPhase("compare");
  }

  const loadLeaderboard = useCallback(async () => {
    try {
      const response = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!response.ok) throw new Error("Leaderboard unavailable");
      setLeaderboard(await response.json());
    } catch {
      setLeaderboard(null);
    }
  }, []);

  useEffect(() => {
    if (phase !== "results") return;
    let cancelled = false;
    fetch("/api/leaderboard", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Leaderboard unavailable");
        return response.json() as Promise<LeaderboardResponse>;
      })
      .then((data) => {
        if (!cancelled) setLeaderboard(data);
      })
      .catch(() => {
        if (!cancelled) setLeaderboard(null);
      });

    return () => { cancelled = true; };
  }, [phase]);

  useEffect(() => {
    if (phase !== "results" || scoredRanking.length === 0) return;

    const signature = JSON.stringify({ scoredRanking, favoriteDish });
    if (savedSignature.current === signature) return;
    savedSignature.current = signature;

    const rankings = scoredRanking.map(({ vendorId, bucket, withinBucketRank, score }) => ({
      vendorId,
      bucket,
      withinBucketRank,
      computedScore: score,
    }));

    void fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rankings,
        favoriteDish: topVendor && favoriteDish ? {
          vendorId: topVendor.id,
          dishName: favoriteDish,
        } : null,
      }),
    }).then(() => void loadLeaderboard()).catch(() => void loadLeaderboard());
  }, [favoriteDish, loadLeaderboard, phase, scoredRanking, topVendor]);

  const drawShareCanvas = useCallback(async (canvas: HTMLCanvasElement) => {
    const vendorImages = new Map(await Promise.all(scoredRanking.map(async ({ vendor }) => (
      [vendor.id, await loadCanvasImage(vendor.image)] as const
    ))));

    const rootStyles = getComputedStyle(document.documentElement);
    const cssToken = (name: string, fallback: string) => rootStyles.getPropertyValue(name).trim() || fallback;
    const paper = cssToken("--paper", "#F7F4EF");
    const ink = cssToken("--ink", "#211B24");
    const purple = cssToken("--purple", "#4E2A84");
    const muted = cssToken("--muted", "#746D78");
    const sansFont = `${cssToken("--font-sans", "Arial")}, Arial, sans-serif`;
    const displayFont = `${cssToken("--font-display", "Georgia")}, Georgia, serif`;

    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unsupported");

    context.fillStyle = paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = ink;
    context.font = `650 70px ${displayFont}`;
    context.fillText("My Northwestern dining ranked", 72, 128, 936);

    const compactRanking = scoredRanking.length > 9;
    const rankingStart = 178;
    const rankingStep = compactRanking ? 84 : 92;
    scoredRanking.forEach(({ vendor, score }, index) => {
      const y = rankingStart + index * rankingStep;

      context.fillStyle = purple;
      context.font = `650 60px ${displayFont}`;
      const displayedRank = scoredRanking.findIndex((item) => item.score === score) + 1;
      context.fillText(String(displayedRank), 78, y + 62);

      const imageSize = 82;
      const vendorImage = vendorImages.get(vendor.id);
      if (vendorImage) drawRoundedCanvasImage(context, vendorImage, 130, y + 1, imageSize, 24);

      context.fillStyle = ink;
      context.font = `650 48px ${sansFont}`;
      context.fillText(vendor.name, 230, y + 61, 590);

      const scoreX = 862;
      const scoreY = y + 5;
      const scoreWidth = 124;
      const scoreHeight = 74;
      context.strokeStyle = purple;
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(scoreX, scoreY, scoreWidth, scoreHeight, scoreHeight / 2);
      context.stroke();
      context.fillStyle = purple;
      context.font = `700 36px ${sansFont}`;
      context.textAlign = "center";
      context.fillText(score.toFixed(1), scoreX + scoreWidth / 2, scoreY + 50);
      context.textAlign = "left";
    });

    if (favoriteDish && topVendor) {
      context.fillStyle = purple;
      context.font = `700 22px ${sansFont}`;
      context.fillText("MY FAVORITE", 72, 1158);
      context.fillStyle = ink;
      context.font = `650 30px ${sansFont}`;
      const favoriteLines = drawWrappedCanvasText(context, favoriteDish, 72, 1197, 936, 34);
      context.fillStyle = muted;
      context.font = `500 21px ${sansFont}`;
      context.fillText(`at ${topVendor.name}`, 72, 1203 + favoriteLines * 34, 936);
    }

    context.fillStyle = muted;
    context.font = `500 24px ${sansFont}`;
    context.fillText(SITE_HOSTNAME, 72, 1315);
  }, [favoriteDish, scoredRanking, topVendor]);

  async function createShareFile() {
    await document.fonts.ready;
    const canvas = document.createElement("canvas");
    await drawShareCanvas(canvas);

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not create image")), "image/png"),
    );
    return new File([blob], "my-meal-exchange-ranking.png", { type: "image/png" });
  }

  async function shareResult() {
    try {
      const file = await createShareFile();
      const data = {
        title: "My Northwestern campus dining ranking",
        text: `I ranked Northwestern's campus dining spots — make yours at ${SITE_URL}`,
        files: [file],
      };

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share(data);
        setShareStatus("Shared");
      } else {
        downloadFile(file);
        setShareStatus("Image downloaded");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") setShareStatus("Could not share the image.");
    }
  }

  function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (phase === "landing") {
    return (
      <main className="site-shell landing">
        <section className="landing__hero">
          <div className="landing__copy">
            <h1>Rank your<br /><em>campus dining spots.</em></h1>
            <button className="button button--primary button--large" onClick={startRanking}>Start ranking <span>→</span></button>
          </div>
          <div className="card-stack" aria-hidden="true">
            {[vendors[0], vendors[4], vendors[1]].map((vendor, index) => (
              <div className={`stack-card stack-card--${index + 1}`} key={vendor.id}>
                <VendorArt vendor={vendor} />
                <div className="stack-card__label"><span>{vendor.name}</span><b>{9 - index}.<small>{8 - index}</small></b></div>
              </div>
            ))}
          </div>
        </section>
        <p className="project-disclaimer">Independent project inspired by Beli. Not affiliated with or endorsed by Beli or Northwestern University.</p>
      </main>
    );
  }

  if (phase === "bucket") {
    const vendor = vendorOrder[bucketIndex];
    return (
      <main className="site-shell flow-shell">
        <AppHeader step="Phase One: Your Preferences" />
        <div className="progress-row"><span>{bucketIndex + 1} of {vendorOrder.length}</span><div className="progress-track"><i style={{ width: `${((bucketIndex + 1) / vendorOrder.length) * 100}%` }} /></div></div>
        <section className="flow-content bucket-screen">
          <div className="prompt-block"><h2><span className="prompt-nowrap">How do you feel about</span><br /><em>{vendor.name}?</em></h2></div>
          <article className="focus-card">
            <VendorArt vendor={vendor} />
            <div className="focus-card__copy"><h3>{vendor.name}</h3></div>
          </article>
          <div className="bucket-buttons">
            {bucketOrder.map((bucket) => <button key={bucket} onClick={() => chooseBucket(bucket)}><span>{bucketMeta[bucket].mark}</span>{bucketMeta[bucket].label}</button>)}
          </div>
          <button className="text-button" onClick={() => chooseBucket("untried")}>Haven&apos;t tried it</button>
          <button className="back-button" onClick={undoBucketChoice}>← Back</button>
        </section>
      </main>
    );
  }

  if (phase === "compare" && machine?.left && machine.right) {
    const left = vendorById[machine.left[machine.leftIndex]];
    const right = vendorById[machine.right[machine.rightIndex]];
    return (
      <main className="site-shell flow-shell">
        <AppHeader step="Phase 2: Head-to-head" />
        <div className="progress-row"><span>Choice {comparisons + 1}</span><div className="progress-track progress-track--open"><i /></div></div>
        <section className="flow-content compare-screen">
          <div className="prompt-block"><h2>Which would you<br /><em>rather have?</em></h2></div>
          <div className="versus-grid">
            {[left, right].map((vendor) => (
              <button className="versus-card" key={vendor.id} onClick={() => chooseComparison(vendor.id)}>
                <VendorArt vendor={vendor} />
                <span className="versus-card__name">{vendor.name}</span>
              </button>
            ))}
            <i className="or-badge">or</i>
          </div>
          <button className="comparison-neutral" onClick={() => chooseComparison(null)}>Too tough <span>↔</span></button>
          <button className="back-button" onClick={undoComparison}>← Back</button>
        </section>
      </main>
    );
  }

  if (phase === "dish") {
    if (!topVendor) return null;
    const cleanedFavorite = favoriteDraft.replace(/\s+/g, " ").trim();
    return (
      <main className="site-shell flow-shell">
        <AppHeader step="Phase 3: Your Favorite Item" />
        <section className="flow-content dish-screen">
          <div className="dish-winner"><span>{topScoreTieCount > 1 ? "Tied for #1" : "Your #1"}</span><VendorArt vendor={topVendor} compact /><h3>{topVendor.name}</h3></div>
          <div className="prompt-block"><p className="eyebrow">Optional</p><h2>What&apos;s your go-to<br />at <em>{topVendor.name}?</em></h2></div>
          <form
            className="favorite-entry"
            onSubmit={(event) => {
              event.preventDefault();
              if (!cleanedFavorite) return;
              setFavoriteDish(cleanedFavorite);
              setPhase("results");
            }}
          >
            <label className="sr-only" htmlFor="favorite-dish">Favorite item or order</label>
            <input
              id="favorite-dish"
              value={favoriteDraft}
              onChange={(event) => setFavoriteDraft(event.target.value)}
              placeholder="e.g. Chicken quesadilla, Rawcai Bowl"
              maxLength={80}
              autoComplete="off"
            />
            <button className="button button--primary" type="submit" disabled={!cleanedFavorite}>View my results <span>→</span></button>
          </form>
          <button className="text-button" onClick={() => setPhase("results")}>Skip</button>
          <button className="back-button" onClick={undoComparison}>← Back</button>
        </section>
      </main>
    );
  }

  return (
    <main className="site-shell results-shell">
      <AppHeader step="Phase 4: Your results" />
      <section className="results-intro"><h2>Your dining spots,<br /> <em>ranked.</em></h2></section>
      <div className="results-layout">
        <div className="personal-results">
          {scoredRanking.length > 0 ? (
            <section className="personal-ranking" aria-label="Your ranked campus dining spots">
              <div className="section-heading"><h2>My Northwestern dining ranked</h2></div>
              <ol className="leaderboard-list">
                {scoredRanking.map(({ vendor, score }) => {
                  const displayedRank = scoredRanking.findIndex((item) => item.score === score) + 1;
                  return (
                    <li key={vendor.id}>
                      <span className="leaderboard-rank">{displayedRank}</span>
                      <VendorArt vendor={vendor} compact />
                      <span><b>{vendor.name}</b></span>
                      <strong>{score.toFixed(1)}</strong>
                    </li>
                  );
                })}
              </ol>
              {favoriteDish && topVendor && (
                <div className="personal-favorite">
                  <span>My favorite</span>
                  <b>{favoriteDish}</b>
                  <small>at {topVendor.name}</small>
                </div>
              )}
            </section>
          ) : <section className="result-card"><div className="empty-result"><b>Nothing to rank yet.</b><span>Try again after you&apos;ve visited a few campus dining spots.</span></div></section>}

          <div className={`share-actions${scoredRanking.length === 0 ? " share-actions--single" : ""}`}>
            {scoredRanking.length > 0 && <button className="button button--primary" onClick={shareResult}>Share result</button>}
            <button className="button button--secondary" onClick={reset}>Rank again</button>
            {shareStatus && <p role="status">{shareStatus}</p>}
          </div>
        </div>

        <section className="campus-section">
          <div className="section-heading"><h2>Northwestern&apos;s Leaderboard</h2></div>
          {!leaderboard ? <div className="leaderboard-loading">Loading the campus ranking…</div> : (
            leaderboard.completionCount < leaderboardUnlockCount ? (
              <div className="leaderboard-message">share with your friends to gather enough data for a leaderboard :)</div>
            ) : (
              <>
                <p className="leaderboard-community-note">
                  {leaderboard.completionCount} students ranked
                  <span aria-hidden="true"> · </span>
                  {leaderboard.completionCount < leaderboardSharingGoal
                    ? `Share with your friends to help us reach ${leaderboardSharingGoal} :)`
                    : "Share with your friends to make the leaderboard even better :)"}
                </p>
                <ol className="leaderboard-list">
                  {leaderboard.entries.map((entry, index) => {
                    const vendor = vendorById[entry.vendorId];
                    if (!vendor) return null;
                    return <li key={entry.vendorId}><span className="leaderboard-rank">{index + 1}</span><VendorArt vendor={vendor} compact /><span><b>{vendor.name}</b></span><strong>{entry.averageScore.toFixed(1)}</strong></li>;
                  })}
                </ol>
              </>
            )
          )}
        </section>
      </div>
    </main>
  );
}
