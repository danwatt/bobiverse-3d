import type { BobReplicant } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Horizontal distance between one generation and the next, in px. */
const COLUMN = 132;
/** Vertical distance between two leaves, in px. */
const ROW = 19;
/** Extra vertical gap between separate roots, in rows. */
const ROOT_GAP = 1.5;
const PAD_X = 14;
const PAD_Y = 14;
/** Space kept to the right of the last column so the deepest names aren't clipped. */
const LABEL_ROOM = 96;
const NODE_R = 4;
/** Left edge of a node's name, relative to its dot. */
const LABEL_X = 9;
/** Clearance between a name and any line routed around it. */
const EDGE_GAP = 7;
/**
 * Advance width per character at the label's 11px, used only when the browser can't measure the
 * text yet — an over-estimate, because a line too far from a name beats one drawn through it.
 */
const CHAR_PX = 7;

/** What a replicant is doing at the year currently on the timeline. */
type BobPhase = 'pending' | 'alive' | 'lost';

export interface FamilyTree {
  /** Recolour the tree for a year on the timeline. */
  setYear(year: number): void;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Fires when a node is clicked, so the map can jump to that Bob's birthplace. */
  onSelect(callback: (bob: BobReplicant) => void): void;
}

export interface FamilyTreeOptions {
  /** Host element for the SVG — the scrollable body of the tree panel. */
  host: HTMLElement;
  panel: HTMLElement;
  /** Resolves a `Star.id` to a display name for the tooltip. */
  systemName(id: string): string;
}

interface TreeNode {
  bob: BobReplicant;
  children: TreeNode[];
  depth: number;
  x: number;
  y: number;
}

/** One rendered node plus the edge coming into it, so `setYear` can restyle both. */
interface NodeView {
  bob: BobReplicant;
  group: SVGGElement;
  edge: SVGPathElement | null;
}

function phaseAt(bob: BobReplicant, year: number): BobPhase {
  if (year < bob.created) return 'pending';
  if (bob.destroyed !== null && year >= bob.destroyed) return 'lost';
  return 'alive';
}

/**
 * Turn the flat replicant table into a forest.
 *
 * Bob is the only true root, but Bridget-R is replicated from a human rather than cloned from a
 * Bob, so she carries no parent and starts a second tree.
 */
function buildForest(bobs: BobReplicant[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const bob of bobs) {
    nodes.set(bob.name, { bob, children: [], depth: 0, x: 0, y: 0 });
  }

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.bob.parent === null ? undefined : nodes.get(node.bob.parent);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Siblings read as a history when they're in creation order; ties fall back to name so the
  // layout is stable between runs.
  const byCreation = (a: TreeNode, b: TreeNode): number =>
    a.bob.created - b.bob.created || a.bob.name.localeCompare(b.bob.name);
  roots.sort(byCreation);
  for (const node of nodes.values()) node.children.sort(byCreation);

  return roots;
}

/**
 * Dendrogram layout: depth picks the column, and every leaf gets its own row. A parent sits
 * halfway between its first and last child, which keeps the wide sibling groups — Khan's nine,
 * Loki's eight — readable without any of the tidier algorithms' bookkeeping.
 */
function layout(roots: TreeNode[]): { nodes: TreeNode[]; width: number; height: number } {
  const flat: TreeNode[] = [];
  let nextLeafRow = 0;
  let maxDepth = 0;

  function place(node: TreeNode, depth: number): void {
    node.depth = depth;
    node.x = PAD_X + depth * COLUMN;
    maxDepth = Math.max(maxDepth, depth);
    flat.push(node);

    if (node.children.length === 0) {
      node.y = PAD_Y + nextLeafRow * ROW;
      nextLeafRow += 1;
      return;
    }

    for (const child of node.children) place(child, depth + 1);
    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    node.y = (first.y + last.y) / 2;
  }

  for (const root of roots) {
    place(root, 0);
    nextLeafRow += ROOT_GAP;
  }

  return {
    nodes: flat,
    width: PAD_X + maxDepth * COLUMN + LABEL_ROOM,
    height: PAD_Y * 2 + Math.max(0, nextLeafRow - ROOT_GAP) * ROW,
  };
}

/**
 * Orthogonal elbow from a parent node to a child node, routed clear of the names.
 *
 * The line leaves past the end of the parent's own label and turns down in the gutter beyond
 * the widest label in that column, so neither the horizontal run nor the vertical one crosses
 * text — a line through a name reads as a strike-through, which already means "destroyed" here.
 */
function elbowPath(parent: TreeNode, child: TreeNode, exitX: number, gutterX: number): string {
  // The gutter still has to land short of the child's dot, however long the column's names run.
  const bendX = Math.min(Math.max(gutterX, exitX), child.x - NODE_R - 6);
  return `M ${exitX} ${parent.y} H ${bendX} V ${child.y} H ${child.x - NODE_R - 2}`;
}

export function createFamilyTree(
  bobs: BobReplicant[],
  options: FamilyTreeOptions,
): FamilyTree {
  const { host, panel, systemName } = options;

  const roots = buildForest(bobs);
  const { nodes, width, height } = layout(roots);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ft-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  // Edges first so the node dots and their glow sit on top of the lines. Both layers are made
  // up front, but the edges can only be drawn once the labels they route around are measurable.
  const edgeLayer = document.createElementNS(SVG_NS, 'g');
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  svg.append(edgeLayer, nodeLayer);
  host.append(svg);

  const views: NodeView[] = [];
  const edgesByChild = new Map<string, SVGPathElement>();
  const labelsByName = new Map<string, SVGTextElement>();

  let selectCallback: ((bob: BobReplicant) => void) | null = null;

  for (const node of nodes) {
    const { bob } = node;

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'ft-node');
    group.setAttribute('transform', `translate(${node.x} ${node.y})`);
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'ft-dot');
    dot.setAttribute('r', String(NODE_R));

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'ft-label');
    label.setAttribute('x', String(LABEL_X));
    label.setAttribute('y', '3.5');
    label.textContent = bob.name;

    const title = document.createElementNS(SVG_NS, 'title');
    const born = `${Math.floor(bob.created)} at ${systemName(bob.atId)}`;
    const fate = bob.destroyed === null ? 'survives books 1-3' : `lost ${Math.floor(bob.destroyed)}`;
    // `gen` comes from the source timeline and doesn't always match the depth of the parent
    // chain, so it's reported rather than used for layout.
    title.textContent = `${bob.name} · gen ${bob.gen} · book ${bob.book}\nbuilt ${born}\n${fate}`;

    group.append(title, dot, label);
    nodeLayer.append(group);
    labelsByName.set(bob.name, label);

    const activate = (): void => selectCallback?.(bob);
    group.addEventListener('click', activate);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });

    views.push({ bob, group, edge: null });
  }

  for (const node of nodes) {
    for (const child of node.children) {
      const edge = document.createElementNS(SVG_NS, 'path');
      edge.setAttribute('class', 'ft-edge');
      edgeLayer.append(edge);
      edgesByChild.set(child.bob.name, edge);
    }
  }

  // An edge belongs to the child it feeds, so it can share that child's state.
  for (const view of views) view.edge = edgesByChild.get(view.bob.name) ?? null;

  /**
   * Point every edge around the names, and report whether the browser could measure them.
   *
   * A hidden panel has no laid-out text, so the first pass falls back to estimated widths and
   * the routing is redone the first time the tree is actually shown.
   */
  function routeEdges(): boolean {
    let measured = true;
    const labelEnds = new Map<string, number>();
    /** One gutter per column, clear of every name in it, so the vertical runs line up. */
    const gutters: number[] = [];

    for (const node of nodes) {
      const label = labelsByName.get(node.bob.name);
      const width = label?.getComputedTextLength() || 0;
      if (width === 0) measured = false;
      const end = node.x + LABEL_X + (width || node.bob.name.length * CHAR_PX);
      labelEnds.set(node.bob.name, end);
      gutters[node.depth] = Math.max(gutters[node.depth] ?? 0, end + EDGE_GAP);
    }

    for (const node of nodes) {
      const exitX = (labelEnds.get(node.bob.name) ?? node.x) + EDGE_GAP;
      for (const child of node.children) {
        const edge = edgesByChild.get(child.bob.name);
        edge?.setAttribute('d', elbowPath(node, child, exitX, gutters[node.depth]));
      }
    }

    return measured;
  }

  let routed = routeEdges();

  function setYear(year: number): void {
    for (const view of views) {
      const phase = phaseAt(view.bob, year);
      view.group.dataset.phase = phase;
      if (view.edge) view.edge.dataset.phase = phase;
    }
  }

  function open(): void {
    panel.hidden = false;
    if (!routed) routed = routeEdges();
  }

  function close(): void {
    panel.hidden = true;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });

  return {
    setYear,
    open,
    close,
    toggle: () => (panel.hidden ? open() : close()),
    isOpen: () => !panel.hidden,
    onSelect(callback) {
      selectCallback = callback;
    },
  };
}
