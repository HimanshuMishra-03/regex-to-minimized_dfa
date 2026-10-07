import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { compileRegex, simulate, type AutomataPipeline, type Automaton, type AutomatonTransition, type StoryPhase } from './automata';
import './style.css';

type Stage = 'nfa' | 'dfa' | 'minimized';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Form Automata Workbench home"><span class="brand-mark">F</span><span>FORM<span class="brand-slash"> / </span><span class="brand-sub">AUTOMATA WORKBENCH</span></span></a>
      <div class="topbar-meta"><span class="live-dot"></span> LOCAL WORKSPACE <span class="meta-divider"></span> BUILD 01</div>
    </header>

    <main>
      <section class="intro-row">
        <div>
          <p class="eyebrow"><span>01</span> REGULAR EXPRESSION → FINITE AUTOMATA</p>
          <h1>See the machine<br /><em>inside the expression.</em></h1>
        </div>
        <p class="intro-copy">Compile a regex into an NFA, determinize it, then minimize. Follow every state transition in an animated 3D workspace.</p>
      </section>

      <section class="expression-section" aria-label="Regular expression input">
        <div class="expression-label"><span class="step-number">A</span><label for="regex-input">REGULAR EXPRESSION</label><span class="syntax-note">implicit or explicit concatenation</span></div>
        <div class="expression-row">
          <span class="expression-prefix">/</span>
          <input id="regex-input" value="(a|b)" spellcheck="false" autocomplete="off" aria-label="Regular expression" />
          <span class="expression-suffix">/</span>
          <button id="compile-button" class="compile-button" type="button"><span>Compile</span><span aria-hidden="true">↗</span></button>
        </div>
        <div class="expression-bottom"><div class="examples"><span class="examples-label">TRY</span><button class="example-chip" data-regex="(a|b)" type="button">(a|b)</button><button class="example-chip" data-regex="(a.b)*" type="button">(a.b)*</button><button class="example-chip" data-regex="a(b|c)" type="button">a(b|c)</button></div><span id="compile-message" class="compile-message" role="status">Ready to compile</span></div>
      </section>

      <section class="workspace" aria-label="Automata workspace">
        <div class="visual-column">
          <div class="stagebar">
            <div class="stage-tabs" role="tablist" aria-label="Automaton stage">
              <button class="stage-tab" data-stage="nfa" role="tab" type="button"><span class="tab-index">01</span>NFA</button>
              <span class="stage-arrow" aria-hidden="true">→</span>
              <button class="stage-tab" data-stage="dfa" role="tab" type="button"><span class="tab-index">02</span>DFA</button>
              <span class="stage-arrow" aria-hidden="true">→</span>
              <button class="stage-tab is-active" data-stage="minimized" role="tab" type="button"><span class="tab-index">03</span>MINIMIZED</button>
            </div>
            <div class="graph-actions"><button id="zoom-out" class="icon-button" type="button" title="Zoom out" aria-label="Zoom out">−</button><button id="zoom-in" class="icon-button" type="button" title="Zoom in" aria-label="Zoom in">+</button><button id="reset-camera" class="icon-button" type="button" title="Reset view" aria-label="Reset view"><span aria-hidden="true">⌖</span></button></div>
          </div>
          <div class="graph-heading"><div><span id="graph-stage-kicker" class="graph-kicker">STAGE 03 / MINIMIZED DFA</span><h2 id="graph-title">The smallest equivalent machine</h2></div><div class="graph-count"><strong id="state-count">—</strong><span>STATES</span></div></div>
          <div class="graph-frame">
            <div id="graph-viewport" class="graph-viewport" role="region" aria-label="Three dimensional automaton graph"><div id="graph-mount" class="graph-mount"></div></div>
            <div class="graph-overlays"><div class="graph-corner corner-tl">FORM / GRAPH VIEW</div><div class="graph-corner corner-tr">DRAG TO ORBIT · WHEEL TO ZOOM</div><div class="graph-legend"><span><i class="legend-dot start-dot"></i>START</span><span><i class="legend-dot final-dot"></i>FINAL</span><span><i class="legend-dot active-dot"></i>ACTIVE STEP</span></div><div id="graph-empty" class="graph-empty" hidden>Compile an expression to build this automaton.</div></div>
          </div>
          <section class="walkthrough" aria-label="Step-by-step automata construction">
            <div class="walkthrough-main">
              <div class="walkthrough-copy"><div class="story-meta"><span id="story-phase" class="story-phase-tag">BUILD SEQUENCE</span><span id="story-count" class="story-count">READY</span></div><h3 id="story-title">Follow the construction</h3><p id="story-description">Advance through the real steps used to build and minimize this automaton.</p></div>
              <div class="story-controls"><button id="story-previous" class="story-control" type="button" title="Previous step" aria-label="Previous step">←</button><button id="story-play" class="story-control story-play" type="button" title="Play walkthrough" aria-label="Play walkthrough">▶</button><button id="story-next" class="story-control" type="button" title="Next step" aria-label="Next step">→</button></div>
            </div>
            <div class="story-range-row"><input id="story-range" type="range" min="0" max="0" value="0" aria-label="Walkthrough step" /><span id="story-range-count" class="story-range-count">0 / 0</span></div>
            <div class="story-phases" aria-label="Jump to algorithm phase"><button class="story-phase-button" data-phase="nfa" type="button">01 <span>ε-NFA</span></button><button class="story-phase-button" data-phase="dfa" type="button">02 <span>SUBSETS</span></button><button class="story-phase-button" data-phase="partition" type="button">03 <span>PARTITIONS</span></button><button class="story-phase-button" data-phase="minimized" type="button">04 <span>MINIMIZED</span></button></div>
          </section>
          <div class="graph-footer"><span><i class="pulse-dot"></i> LIVE AUTOMATON</span><span id="graph-alphabet">ALPHABET —</span><span id="graph-edge-count">— TRANSITIONS</span></div>
        </div>

        <aside class="inspector">
          <section class="inspector-section table-section">
            <div class="section-heading"><div><p class="eyebrow"><span>02</span> TRANSITION MAP</p><h2>State table</h2></div><span id="table-stage" class="tiny-tag">MINIMIZED</span></div>
            <div id="transition-table" class="table-wrap"></div>
          </section>
          <section class="inspector-section simulate-section">
            <div class="section-heading"><div><p class="eyebrow"><span>03</span> TEST THE MACHINE</p><h2>Run an input</h2></div><span class="sim-icon" aria-hidden="true">▶</span></div>
            <label class="input-caption" for="test-input">INPUT STRING <span>characters are read left to right</span></label>
            <div class="test-input-row"><input id="test-input" value="a" spellcheck="false" autocomplete="off" aria-label="Input string to simulate" /><button id="run-button" class="run-button" type="button"><span aria-hidden="true">▶</span> Run</button></div>
            <div class="sim-actions"><button id="step-button" class="text-button" type="button"><span aria-hidden="true">→|</span> Step</button><button id="clear-button" class="text-button" type="button"><span aria-hidden="true">↺</span> Reset</button><span class="step-hint">one symbol at a time</span></div>
            <div id="simulation-result" class="simulation-result" aria-live="polite"><span class="result-mark">·</span><span>Ready when you are</span></div>
            <div id="trace-list" class="trace-list" aria-label="Simulation trace"></div>
          </section>
          <section class="inspector-section reading-key">
            <span class="key-symbol">ε</span><p><strong>Epsilon transition</strong><br />Moves without consuming an input symbol.</p>
          </section>
        </aside>
      </section>

      <footer class="page-footer"><span>FORM / FINITE STATE LAB</span><span>THOMPSON CONSTRUCTION <i>·</i> SUBSET CONSTRUCTION <i>·</i> PARTITION REFINEMENT</span><span>THREE.JS</span></footer>
    </main>
  </div>
`;

const regexInput = document.querySelector<HTMLInputElement>('#regex-input')!;
const testInput = document.querySelector<HTMLInputElement>('#test-input')!;
const compileButton = document.querySelector<HTMLButtonElement>('#compile-button')!;
const message = document.querySelector<HTMLSpanElement>('#compile-message')!;
const graphViewport = document.querySelector<HTMLDivElement>('#graph-viewport')!;
const graphMount = document.querySelector<HTMLDivElement>('#graph-mount')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9ece5');
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 13);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor('#e9ece5', 1);
renderer.domElement.className = 'graph-canvas';
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'graph-labels';
graphMount.prepend(renderer.domElement, labelRenderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.enableZoom = true;
controls.minDistance = 5;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.83;
scene.add(new THREE.HemisphereLight('#ffffff', '#7f9085', 2.3));
const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
keyLight.position.set(-4, 7, 8);
scene.add(keyLight);
const graphGroup = new THREE.Group();
scene.add(graphGroup);
const edgeCurves: THREE.Curve<THREE.Vector3>[] = [];
const particles: THREE.Mesh[] = [];
let pipeline: AutomataPipeline | null = null;
let selectedStage: Stage = 'minimized';
let simulationPath: string[] = [];
let simulationStep = 0;
let isRunning = false;
let lastResult: 'accepted' | 'rejected' | null = null;
let activeStoryIndex = -1;
let storyTimer = 0;
let hasCameraFrame = false;

type StoryStage = StoryPhase;

function currentStoryStep() {
  return activeStoryIndex >= 0 ? pipeline?.story[activeStoryIndex] ?? null : null;
}

function currentAutomaton(): Automaton | null {
  return currentStoryStep()?.automaton ?? pipeline?.[selectedStage] ?? null;
}

function currentLayoutAutomaton(): Automaton | null {
  const phase = currentStoryStep()?.phase;
  if (phase === 'nfa') return pipeline?.nfa ?? null;
  if (phase === 'dfa' || phase === 'partition') return pipeline?.dfa ?? null;
  if (phase === 'minimized') return pipeline?.minimized ?? null;
  return pipeline?.[selectedStage] ?? null;
}

function clearGraph(): void {
  graphGroup.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
    if (object instanceof CSS2DObject) object.element.remove();
  });
  graphGroup.clear();
  edgeCurves.length = 0;
  particles.length = 0;
}

function graphPositions(automaton: Automaton): Map<string, THREE.Vector3> {
  const positions = new Map<string, THREE.Vector3>();
  const order = new Map(automaton.states.map((state, index) => [state, index]));
  const depths = new Map<string, number>();
  const queue: string[] = [];
  let maxDepth = 0;

  for (const root of [automaton.start, ...automaton.states]) {
    if (depths.has(root)) continue;
    const rootDepth = depths.size ? maxDepth + 1 : 0;
    depths.set(root, rootDepth);
    queue.push(root);
    while (queue.length) {
      const state = queue.shift()!;
      const depth = depths.get(state)!;
      maxDepth = Math.max(maxDepth, depth);
      for (const transition of automaton.transitions) {
        if (transition.from !== state || depths.has(transition.to)) continue;
        depths.set(transition.to, depth + 1);
        queue.push(transition.to);
      }
    }
  }

  const layers = new Map<number, string[]>();
  for (const state of automaton.states) {
    const depth = depths.get(state) ?? 0;
    const layer = layers.get(depth) ?? [];
    layer.push(state);
    layers.set(depth, layer);
  }
  const rowByState = new Map<string, number>();
  const portrait = graphViewport.clientWidth / graphViewport.clientHeight < 0.82;

  for (let depth = 0; depth <= maxDepth; depth++) {
    const layer = layers.get(depth) ?? [];
    layer.sort((left, right) => {
      const barycenter = (state: string) => {
        const parents = automaton.transitions.filter((edge) => edge.to === state && rowByState.has(edge.from));
        return parents.length ? parents.reduce((sum, edge) => sum + rowByState.get(edge.from)!, 0) / parents.length : order.get(state)!;
      };
      return barycenter(left) - barycenter(right) || order.get(left)! - order.get(right)!;
    });
    layer.forEach((state, index) => {
      const row = index - (layer.length - 1) / 2;
      rowByState.set(state, row);
      const along = (depth - maxDepth / 2) * 3.1;
      positions.set(state, portrait
        ? new THREE.Vector3(row * 2.1, -along, 0)
        : new THREE.Vector3(along, -row * 2.1, 0));
    });
  }
  return positions;
}

function pathHasEdge(transition: AutomatonTransition): boolean {
  const inputSymbols = [...testInput.value];
  for (let index = 0; index < simulationStep; index++) {
    if (simulationPath[index] === transition.from && simulationPath[index + 1] === transition.to && inputSymbols[index] === transition.symbol) return true;
  }
  return false;
}

function renderGraph(resetCamera = false): void {
  clearGraph();
  const automaton = currentAutomaton();
  const layoutAutomaton = currentLayoutAutomaton();
  if (!automaton || !layoutAutomaton) return;
  const positions = graphPositions(layoutAutomaton);
  const layoutBounds = new THREE.Box3().setFromPoints([...positions.values()]);
  const layoutSize = layoutBounds.getSize(new THREE.Vector3());
  const canvasWidth = graphViewport.clientWidth;
  const canvasHeight = graphViewport.clientHeight;
  if (!canvasWidth || !canvasHeight) return;
  graphMount.style.width = '100%';
  graphMount.style.height = '100%';
  camera.aspect = canvasWidth / canvasHeight;
  renderer.setSize(canvasWidth, canvasHeight);
  labelRenderer.setSize(canvasWidth, canvasHeight);
  const storyStep = currentStoryStep();
  const focusStates = new Set(storyStep?.focusStates ?? []);
  const partitionPalette = ['#78b79c', '#e5a079', '#7ba6b2', '#c1a9ca', '#ccb957', '#8b9fb7'];
  const partitionIndex = (state: string) => storyStep?.phase === 'partition' ? storyStep.groups?.findIndex((group) => group.includes(state)) ?? -1 : -1;
  const visited = new Set(simulationPath.slice(0, simulationStep + 1));

  for (const transition of automaton.transitions) {
    const from = positions.get(transition.from)!;
    const to = positions.get(transition.to)!;
    const active = storyStep
      ? storyStep.focusTransitions.some((edge) => edge.from === transition.from && edge.to === transition.to && edge.symbol === transition.symbol)
      : pathHasEdge(transition);
    let curve: THREE.Curve<THREE.Vector3>;
    if (transition.from === transition.to) {
      curve = new THREE.CubicBezierCurve3(
        from.clone().add(new THREE.Vector3(0.2, 0.25, 0)),
        from.clone().add(new THREE.Vector3(0.76, 1.1, 0)),
        from.clone().add(new THREE.Vector3(-0.76, 1.1, 0)),
        from.clone().add(new THREE.Vector3(-0.2, 0.25, 0)),
      );
    } else {
      const direction = to.clone().sub(from).normalize();
      const edgeStart = from.clone().add(direction.clone().multiplyScalar(0.36));
      const edgeEnd = to.clone().sub(direction.clone().multiplyScalar(0.39));
      const midpoint = edgeStart.clone().add(edgeEnd).multiplyScalar(0.5);
      const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0);
      const duplicateCount = automaton.transitions.filter((edge) => edge.from === transition.from && edge.to === transition.to).length;
      const offset = duplicateCount > 1 ? (transition.symbol === automaton.alphabet[0] ? 0.55 : -0.55) : 0.14;
      curve = new THREE.QuadraticBezierCurve3(edgeStart, midpoint.add(perpendicular.multiplyScalar(offset)), edgeEnd);
    }
    edgeCurves.push(curve);
    const points = curve.getPoints(36);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: active ? '#d36b4c' : '#9ca9a0', transparent: true, opacity: active ? 0.95 : 0.75 }));
    graphGroup.add(line);
    const arrowLength = 0.2;
    const arrowT = Math.max(0, 1 - (arrowLength / 2 + 0.025) / curve.getLength());
    const tangent = curve.getTangentAt(arrowT).normalize();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.075, arrowLength, 12), new THREE.MeshStandardMaterial({ color: active ? '#d36b4c' : '#84948a', roughness: 0.6 }));
    arrow.position.copy(curve.getPointAt(arrowT));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    graphGroup.add(arrow);

    const labelElement = document.createElement('div');
    labelElement.className = `edge-label${active ? ' edge-label-active' : ''}`;
    labelElement.textContent = transition.symbol ?? 'ε';
    const label = new CSS2DObject(labelElement);
    label.position.copy(curve.getPointAt(0.5));
    graphGroup.add(label);

    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), new THREE.MeshBasicMaterial({ color: '#d36b4c' }));
    particle.userData.curveIndex = edgeCurves.length - 1;
    particle.userData.offset = particles.length / Math.max(1, automaton.transitions.length);
    particle.visible = active;
    graphGroup.add(particle);
    particles.push(particle);
  }

  for (const state of automaton.states) {
    const groupIndex = partitionIndex(state);
    const active = storyStep
      ? storyStep.phase !== 'partition' && focusStates.has(state)
      : selectedStage === 'minimized' && simulationStep > 0 && visited.has(state);
    const final = automaton.finals.includes(state);
    const start = state === automaton.start;
    const groupColor = groupIndex >= 0 ? partitionPalette[groupIndex % partitionPalette.length] : null;
    const fill = active ? '#d36b4c' : groupColor ?? (final ? '#76b9a0' : '#f7f8f2');
    const rim = groupColor ?? (start ? '#426e61' : final ? '#4e937b' : active ? '#a64d38' : '#9ba99f');
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.39, 32, 24),
      new THREE.MeshStandardMaterial({ color: fill, roughness: 0.36, metalness: 0.04, emissive: active ? '#6e2e1f' : '#000000', emissiveIntensity: active ? 0.26 : 0 }),
    );
    node.position.copy(positions.get(state)!);
    node.userData.baseY = node.position.y;
    graphGroup.add(node);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 36), new THREE.MeshBasicMaterial({ color: rim }));
    ring.position.copy(node.position).add(new THREE.Vector3(0, 0, 0.25));
    graphGroup.add(ring);
    if (final) {
      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.018, 8, 36), new THREE.MeshBasicMaterial({ color: rim }));
      innerRing.position.copy(node.position).add(new THREE.Vector3(0, 0, 0.25));
      graphGroup.add(innerRing);
    }
    const labelElement = document.createElement('div');
    labelElement.className = `node-label${active ? ' node-label-active' : ''}`;
    labelElement.textContent = state;
    if (automaton.stateDetails?.[state]) {
      const detail = document.createElement('small');
      detail.textContent = automaton.stateDetails[state];
      labelElement.append(detail);
    }
    const label = new CSS2DObject(labelElement);
    label.position.copy(node.position).add(new THREE.Vector3(0, -0.61, 0.05));
    graphGroup.add(label);
    if (start) {
      const startLabel = document.createElement('div');
      startLabel.className = 'start-label';
      startLabel.textContent = 'START';
      const startTag = new CSS2DObject(startLabel);
      startTag.position.copy(node.position).add(new THREE.Vector3(0, 0.67, 0));
      graphGroup.add(startTag);
    }
  }

  const center = layoutBounds.getCenter(new THREE.Vector3());
  const fitWidth = Math.max(layoutSize.x + 2.2, 4.8);
  const fitHeight = Math.max(layoutSize.y + 3.4, 5.2);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const verticalFit = fitHeight / (2 * Math.tan(halfFov));
  const horizontalFit = fitWidth / (2 * Math.tan(halfFov) * camera.aspect);
  const viewDirection = resetCamera || !hasCameraFrame
    ? new THREE.Vector3(0, 0, 1)
    : camera.position.clone().sub(controls.target).normalize();
  const viewDistance = Math.max(5, verticalFit, horizontalFit) * 1.12;
  camera.position.copy(center).add(viewDirection.multiplyScalar(viewDistance));
  controls.target.copy(center);
  controls.minDistance = Math.max(1.2, Math.min(5, viewDistance * 0.15));
  controls.maxDistance = Math.max(30, viewDistance * 5);
  hasCameraFrame = true;
  camera.near = 0.1;
  camera.far = Math.max(100, Math.max(layoutSize.x, layoutSize.y) * 10);
  camera.updateProjectionMatrix();
  controls.update();
  updateGraphMeta(automaton);
}

function updateGraphMeta(automaton: Automaton): void {
  const storyStep = currentStoryStep();
  const phaseNames: Record<StoryStage, string> = { nfa: 'EPSILON-NFA', dfa: 'SUBSET CONSTRUCTION', partition: 'PARTITION REFINEMENT', minimized: 'MINIMIZED DFA' };
  const descriptions: Record<StoryStage, string> = { nfa: 'Thompson epsilon-NFA', dfa: 'Subset construction', partition: 'DFA partition refinement', minimized: 'Equivalent states merged' };
  document.querySelector('#graph-stage-kicker')!.textContent = storyStep
    ? `BUILD STEP ${String(activeStoryIndex + 1).padStart(2, '0')} / ${phaseNames[storyStep.phase]}`
    : `STAGE 0${selectedStage === 'nfa' ? 1 : selectedStage === 'dfa' ? 2 : 3} / ${phaseNames[selectedStage]}`;
  document.querySelector('#graph-title')!.textContent = storyStep ? descriptions[storyStep.phase] : descriptions[selectedStage];
  document.querySelector('#state-count')!.textContent = String(automaton.states.length).padStart(2, '0');
  document.querySelector('#graph-alphabet')!.textContent = `ALPHABET { ${automaton.alphabet.join(', ') || 'ε'} }`;
  document.querySelector('#graph-edge-count')!.textContent = `${automaton.transitions.length} TRANSITIONS`;
}

function zoomCamera(factor: number): void {
  const offset = camera.position.clone().sub(controls.target);
  const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(distance));
  controls.update();
}

function renderTable(): void {
  const automaton = currentAutomaton();
  const wrap = document.querySelector<HTMLDivElement>('#transition-table')!;
  const storyStep = currentStoryStep();
  document.querySelector('#table-stage')!.textContent = storyStep?.phase === 'partition' ? 'PARTITIONS' : selectedStage === 'minimized' ? 'MINIMIZED' : selectedStage.toUpperCase();
  if (!automaton) {
    wrap.innerHTML = '<p class="table-empty">Compile an expression to see its transitions.</p>';
    return;
  }
  const symbols: (string | null)[] = selectedStage === 'nfa' ? [...automaton.alphabet, null] : automaton.alphabet;
  const headers = symbols.map((symbol) => `<th scope="col">${escapeHtml(symbol ?? 'ε')}</th>`).join('');
  const rows = automaton.states.map((state) => {
    const cells = symbols.map((symbol) => {
      const targets = [...new Set(automaton.transitions.filter((edge) => edge.from === state && edge.symbol === symbol).map((edge) => edge.to))];
      const target = targets.join(', ') || '—';
      return `<td>${escapeHtml(target)}</td>`;
    }).join('');
    const classes = [state === automaton.start ? 'row-start' : '', automaton.finals.includes(state) ? 'row-final' : ''].filter(Boolean).join(' ');
    return `<tr class="${classes}"><th scope="row"><span class="row-state">${escapeHtml(state)}</span>${state === automaton.start ? '<span class="row-marker">S</span>' : ''}${automaton.finals.includes(state) ? '<span class="row-final-marker">F</span>' : ''}</th>${cells}</tr>`;
  }).join('');
  wrap.innerHTML = `<table><thead><tr><th scope="col">STATE</th>${headers}</tr></thead><tbody>${rows}</tbody></table><p class="final-note"><span>F</span> ${automaton.finals.length ? automaton.finals.join(', ') : 'No accepting states'}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function updateSimulation(): void {
  const result = document.querySelector<HTMLDivElement>('#simulation-result')!;
  const trace = document.querySelector<HTMLDivElement>('#trace-list')!;
  const automaton = pipeline?.minimized;
  if (!automaton) {
    result.className = 'simulation-result';
    result.innerHTML = '<span class="result-mark">·</span><span>Compile an expression to begin</span>';
    trace.innerHTML = '';
    return;
  }
  if (!simulationPath.length) simulationPath = [automaton.start];
  const complete = simulationStep >= [...testInput.value].length;
  if (lastResult && complete) {
    result.className = `simulation-result result-${lastResult}`;
    result.innerHTML = `<span class="result-mark">${lastResult === 'accepted' ? '✓' : '×'}</span><span>${lastResult === 'accepted' ? 'String accepted' : 'String rejected'} <small>· ended in ${escapeHtml(simulationPath.at(-1) ?? automaton.start)}</small></span>`;
  } else if (simulationStep > 0) {
    result.className = 'simulation-result result-progress';
    result.innerHTML = `<span class="result-mark">→</span><span>Reading input <small>· ${simulationStep} of ${[...testInput.value].length} symbols</small></span>`;
  } else {
    result.className = 'simulation-result';
    result.innerHTML = '<span class="result-mark">·</span><span>Ready when you are</span>';
  }
  trace.innerHTML = simulationPath.map((state, index) => `<span class="trace-state${index === simulationPath.length - 1 ? ' trace-current' : ''}">${escapeHtml(state)}</span>${index < simulationPath.length - 1 ? `<span class="trace-arrow">${escapeHtml([...testInput.value][index] ?? '→')}</span>` : ''}`).join('');
}

function resetSimulation(): void {
  simulationPath = pipeline ? [pipeline.minimized.start] : [];
  simulationStep = 0;
  lastResult = null;
  renderGraph();
  updateSimulation();
}

function stepSimulation(): void {
  if (!pipeline || isRunning) return;
  focusMinimizedForSimulation();
  const symbols = [...testInput.value];
  if (simulationStep >= symbols.length) {
    const outcome = simulate(pipeline.minimized, testInput.value);
    if (outcome.error) showSimulationError(outcome.error);
    else {
      lastResult = outcome.accepted ? 'accepted' : 'rejected';
      updateSimulation();
    }
    return;
  }
  const result = simulate(pipeline.minimized, symbols.slice(0, simulationStep + 1).join(''));
  if (result.error) {
    showSimulationError(result.error);
    return;
  }
  simulationPath = result.path;
  simulationStep++;
  lastResult = simulationStep === symbols.length ? (result.accepted ? 'accepted' : 'rejected') : null;
  renderGraph();
  updateSimulation();
}

function showSimulationError(text: string): void {
  const result = document.querySelector<HTMLDivElement>('#simulation-result')!;
  result.className = 'simulation-result result-rejected';
  result.innerHTML = `<span class="result-mark">!</span><span>${escapeHtml(text)}</span>`;
}

function compile(): void {
  try {
    const nextPipeline = compileRegex(regexInput.value);
    stopStoryPlayback();
    pipeline = nextPipeline;
    activeStoryIndex = -1;
    selectedStage = 'minimized';
    simulationPath = [nextPipeline.minimized.start];
    simulationStep = 0;
    lastResult = null;
    message.textContent = `${nextPipeline.nfa.states.length} NFA → ${nextPipeline.dfa.states.length} DFA → ${nextPipeline.minimized.states.length} minimized`;
    message.className = 'compile-message is-success';
    document.querySelector('#graph-empty')!.setAttribute('hidden', '');
    syncStageTabs();
    renderGraph(true);
    renderTable();
    updateSimulation();
    updateStoryControls();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Could not compile this expression.';
    message.className = 'compile-message is-error';
  }
}

function syncStageTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.stage-tab').forEach((button) => {
    const active = button.dataset.stage === selectedStage;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function updateStoryControls(): void {
  const steps = pipeline?.story ?? [];
  const step = currentStoryStep();
  const phaseNames: Record<StoryStage, string> = { nfa: '01 / EPSILON-NFA', dfa: '02 / DFA SUBSETS', partition: '03 / PARTITION REFINEMENT', minimized: '04 / MINIMIZED DFA' };
  document.querySelector('#story-phase')!.textContent = step ? phaseNames[step.phase] : 'BUILD SEQUENCE';
  document.querySelector('#story-count')!.textContent = step ? `STEP ${activeStoryIndex + 1} OF ${steps.length}` : `${steps.length} STEPS`;
  document.querySelector('#story-title')!.textContent = step?.title ?? 'Follow the construction';
  const partitionSummary = step?.phase === 'partition' && step.groups
    ? ` Groups: ${step.groups.map((group, index) => `P${index + 1} { ${group.join(', ')} }`).join(' · ')}.`
    : '';
  document.querySelector('#story-description')!.textContent = `${step?.description ?? 'Advance through the real steps used to build and minimize this automaton.'}${partitionSummary}`;

  const range = document.querySelector<HTMLInputElement>('#story-range')!;
  range.max = String(Math.max(0, steps.length - 1));
  range.value = String(Math.max(0, activeStoryIndex));
  range.disabled = !steps.length;
  document.querySelector('#story-range-count')!.textContent = step ? `${activeStoryIndex + 1} / ${steps.length}` : `0 / ${steps.length}`;
  document.querySelector<HTMLButtonElement>('#story-previous')!.disabled = !steps.length || activeStoryIndex <= 0;
  document.querySelector<HTMLButtonElement>('#story-next')!.disabled = !steps.length || activeStoryIndex >= steps.length - 1;
  const playButton = document.querySelector<HTMLButtonElement>('#story-play')!;
  playButton.textContent = storyTimer ? 'Ⅱ' : '▶';
  playButton.title = storyTimer ? 'Pause walkthrough' : 'Play walkthrough';
  playButton.setAttribute('aria-label', playButton.title);
  document.querySelectorAll<HTMLButtonElement>('.story-phase-button').forEach((button) => {
    const phase = button.dataset.phase as StoryStage;
    button.classList.toggle('is-active', step?.phase === phase);
    button.disabled = !steps.some((candidate) => candidate.phase === phase);
  });
}

function setStoryStep(index: number): void {
  if (!pipeline?.story.length) return;
  const previousPhase = currentStoryStep()?.phase;
  activeStoryIndex = Math.max(0, Math.min(index, pipeline.story.length - 1));
  const step = pipeline.story[activeStoryIndex];
  selectedStage = step.phase === 'partition' ? 'dfa' : step.phase;
  syncStageTabs();
  renderGraph(previousPhase !== step.phase);
  renderTable();
  updateStoryControls();
}

function stopStoryPlayback(): void {
  if (storyTimer) window.clearInterval(storyTimer);
  storyTimer = 0;
  updateStoryControls();
}

function moveStoryStep(direction: -1 | 1): void {
  const steps = pipeline?.story ?? [];
  if (!steps.length) return;
  stopStoryPlayback();
  if (activeStoryIndex < 0) setStoryStep(direction > 0 ? 0 : steps.length - 1);
  else setStoryStep(activeStoryIndex + direction);
}

function focusMinimizedForSimulation(): void {
  if (!pipeline) return;
  stopStoryPlayback();
  activeStoryIndex = -1;
  selectedStage = 'minimized';
  syncStageTabs();
  renderGraph();
  renderTable();
  updateStoryControls();
}

function toggleStoryPlayback(): void {
  if (!pipeline?.story.length) return;
  if (storyTimer) {
    stopStoryPlayback();
    return;
  }
  if (activeStoryIndex < 0 || activeStoryIndex === pipeline.story.length - 1) setStoryStep(0);
  storyTimer = window.setInterval(() => {
    if (!pipeline || activeStoryIndex >= pipeline.story.length - 1) stopStoryPlayback();
    else setStoryStep(activeStoryIndex + 1);
  }, 1050);
  updateStoryControls();
}

compileButton.addEventListener('click', compile);
regexInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') compile(); });
document.querySelectorAll<HTMLButtonElement>('.example-chip').forEach((button) => {
  button.addEventListener('click', () => {
    regexInput.value = button.dataset.regex ?? '';
    compile();
  });
});
document.querySelectorAll<HTMLButtonElement>('.stage-tab').forEach((button) => {
  button.addEventListener('click', () => {
    if (!pipeline) return;
    stopStoryPlayback();
    activeStoryIndex = -1;
    selectedStage = button.dataset.stage as Stage;
    syncStageTabs();
    renderGraph(true);
    renderTable();
    updateStoryControls();
  });
});
document.querySelector<HTMLButtonElement>('#story-previous')!.addEventListener('click', () => moveStoryStep(-1));
document.querySelector<HTMLButtonElement>('#story-next')!.addEventListener('click', () => moveStoryStep(1));
document.querySelector<HTMLButtonElement>('#story-play')!.addEventListener('click', toggleStoryPlayback);
document.querySelector<HTMLInputElement>('#story-range')!.addEventListener('input', (event) => {
  const index = Number((event.currentTarget as HTMLInputElement).value);
  stopStoryPlayback();
  setStoryStep(index);
});
document.querySelectorAll<HTMLButtonElement>('.story-phase-button').forEach((button) => {
  button.addEventListener('click', () => {
    const phase = button.dataset.phase as StoryStage;
    const stepIndex = pipeline?.story.findIndex((step) => step.phase === phase) ?? -1;
    if (stepIndex >= 0) {
      stopStoryPlayback();
      setStoryStep(stepIndex);
    }
  });
});
document.querySelector<HTMLButtonElement>('#zoom-in')!.addEventListener('click', () => zoomCamera(0.8));
document.querySelector<HTMLButtonElement>('#zoom-out')!.addEventListener('click', () => zoomCamera(1.25));
document.querySelector<HTMLButtonElement>('#reset-camera')!.addEventListener('click', () => renderGraph(true));
document.querySelector<HTMLButtonElement>('#clear-button')!.addEventListener('click', resetSimulation);
document.querySelector<HTMLButtonElement>('#step-button')!.addEventListener('click', stepSimulation);
testInput.addEventListener('input', resetSimulation);
document.querySelector<HTMLButtonElement>('#run-button')!.addEventListener('click', async () => {
  if (!pipeline || isRunning) return;
  focusMinimizedForSimulation();
  resetSimulation();
  isRunning = true;
  const runButton = document.querySelector<HTMLButtonElement>('#run-button')!;
  runButton.disabled = true;
  const symbols = [...testInput.value];
  if (!symbols.length) {
    const result = simulate(pipeline.minimized, '');
    lastResult = result.accepted ? 'accepted' : 'rejected';
    updateSimulation();
  } else {
    for (let index = 0; index < symbols.length; index++) {
      await new Promise((resolve) => window.setTimeout(resolve, 340));
      if (!pipeline) break;
      const result = simulate(pipeline.minimized, symbols.slice(0, index + 1).join(''));
      if (result.error) {
        showSimulationError(result.error);
        break;
      }
      simulationPath = result.path;
      simulationStep = index + 1;
      lastResult = simulationStep === symbols.length ? (result.accepted ? 'accepted' : 'rejected') : null;
      renderGraph();
      updateSimulation();
    }
  }
  isRunning = false;
  runButton.disabled = false;
});

function resize(): void {
  const width = graphViewport.clientWidth;
  const height = graphViewport.clientHeight;
  if (!width || !height) return;
  if (currentAutomaton()) {
    renderGraph();
    return;
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);
}
new ResizeObserver(resize).observe(graphViewport);
window.addEventListener('resize', resize);
function animate(time: number): void {
  requestAnimationFrame(animate);
  controls.update();
  particles.forEach((particle) => {
    const curve = edgeCurves[particle.userData.curveIndex as number];
    if (curve) particle.position.copy(curve.getPointAt((time * 0.00008 + (particle.userData.offset as number)) % 1));
  });
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
resize();
compile();
animate(0);
