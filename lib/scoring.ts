import type { Bucket } from "./vendors";

export type NeutralPair = readonly [string, string];

const ranges: Record<Bucket, [number, number]> = {
  disliked: [0, 3.3],
  fine: [3.4, 6.6],
  liked: [6.7, 10],
};

export function scoreBucket(bucket: Bucket, orderedIds: string[], neutralPairs: NeutralPair[] = []) {
  const [minimum, maximum] = ranges[bucket];
  const parents = new Map(orderedIds.map((id) => [id, id]));

  function find(id: string): string {
    const parent = parents.get(id) ?? id;
    if (parent === id) return id;
    const root = find(parent);
    parents.set(id, root);
    return root;
  }

  neutralPairs.forEach(([left, right]) => {
    if (!parents.has(left) || !parents.has(right)) return;
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
  });

  const rawScores = orderedIds.map((_, index) => orderedIds.length === 1
    ? (minimum + maximum) / 2
    : maximum - (index * (maximum - minimum)) / (orderedIds.length - 1));
  const groupIndexes = new Map<string, number[]>();
  orderedIds.forEach((id, index) => {
    const root = find(id);
    groupIndexes.set(root, [...(groupIndexes.get(root) ?? []), index]);
  });

  return orderedIds.map((vendorId, index) => {
    const indexes = groupIndexes.get(find(vendorId)) ?? [index];
    const score = indexes.reduce((sum, tiedIndex) => sum + rawScores[tiedIndex], 0) / indexes.length;
    const withinBucketRank = Math.min(...indexes) + 1;

    return { vendorId, score: Number(score.toFixed(1)), withinBucketRank };
  });
}
