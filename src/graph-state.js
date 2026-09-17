export function addThought(state, node) {
  state.nodes.push(node);
  ensureConnected(state);
}

export function restoreGraph(saved) {
  if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) {
    return { nodes: [], edges: [] };
  }
  const nodes = saved.nodes.filter(n => n.status !== 'example' && !/^sample-\d+$/.test(n.id));
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: saved.edges.filter(e => ids.has(idOf(e.source)) && ids.has(idOf(e.target))) };
}

export function recentNodeIds(nodes, limit = 10) {
  return new Set(nodes
    .map((node, index) => ({ id: node.id, index, createdAt: Number(node.createdAt) || 0 }))
    .sort((a, b) => b.createdAt - a.createdAt || b.index - a.index)
    .slice(0, limit)
    .map(node => node.id));
}

const idOf = node => typeof node === 'object' ? node.id : node;

// Add only the bridges needed to join disconnected components. These are not similarity scores.
export function ensureConnected(state) {
  const parent = new Map(state.nodes.map(n => [n.id, n.id]));
  const root = id => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const join = (a, b) => parent.set(root(b), root(a));
  for (const edge of state.edges) {
    const a = idOf(edge.source), b = idOf(edge.target);
    if (parent.has(a) && parent.has(b)) join(a, b);
  }
  for (let i = 1; i < state.nodes.length; i++) {
    const a = state.nodes[i - 1].id, b = state.nodes[i].id;
    if (root(a) === root(b)) continue;
    state.edges.push({ source: a, target: b, weight: 0, kind: 'provisional' });
    join(a, b);
  }
}
