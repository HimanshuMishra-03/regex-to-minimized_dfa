import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { compileRegex, simulate, type AutomataPipeline, type Automaton, type AutomatonTransition } from './automata';
import './style.css';

type Stage = keyof AutomataPipeline;

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
            <button id="reset-camera" class="icon-button" type="button" title="Reset camera" aria-label="Reset camera"><span aria-hidden="true">⌖</span></button>
          </div>
          <div class="graph-heading"><div><span id="graph-stage-kicker" class="graph-kicker">STAGE 03 / MINIMIZED DFA</span><h2 id="graph-title">The smallest equivalent machine</h2></div><div class="graph-count"><strong id="state-count">—</strong><span>STATES</span></div></div>
          <div id="graph-mount" class="graph-mount" aria-label="Interactive three dimensional automaton graph"><div class="graph-corner corner-tl">FORM / GRAPH VIEW</div><div class="graph-corner corner-tr">DRAG TO ORBIT · SCROLL TO ZOOM</div><div class="graph-legend"><span><i class="legend-dot start-dot"></i>START</span><span><i class="legend-dot final-dot"></i>FINAL</span><span><i class="legend-dot active-dot"></i>ACTIVE PATH</span></div><div id="graph-empty" class="graph-empty" hidden>Compile an expression to build this automaton.</div></div>
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
const graphMount = document.querySelector<HTMLDivElement>('#graph-mount')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9ece5');
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 13);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor('#e9ece5', 1);
renderer.domElement.className = 'graph-canvas';
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'graph-labels';
graphMount.prepend(renderer.domElement, labelRenderer.domElement);
const controls = new OrbitControls(camera, labelRenderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.minDistance = 5;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.83;
scene.add(new THREE.HemisphereLight('#ffffff', '#7f9085', 2.3));
const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
keyLight.position.set(-4, 7, 8);
scene.add(keyLight);
const grid = new THREE.GridHelper(30, 30, '#bdc7bd', '#d4dbd2');
grid.position.y = -3.2;
(scene.add(grid));
const graphGroup = new THREE.Group();
scene.add(graphGroup);
const edgeCurves: THREE.QuadraticBezierCurve3[] = [];
const particles: THREE.Mesh[] = [];
let pipeline: AutomataPipeline | null = null;
let selectedStage: Stage = 'minimized';
let simulationPath: string[] = [];
let simulationStep = 0;
let isRunning = false;
let lastResult: 'accepted' | 'rejected' | null = null;

function currentAutomaton(): Automaton | null {
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
  const count = automaton.states.length;
  const radius = Math.max(2.3, count * 0.62);
  automaton.states.forEach((state, index) => {
    const angle = count === 1 ? 0 : Math.PI * 2 * index / count - Math.PI / 2;
    positions.set(state, new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.65, 0));
  });
  return positions;
}

function pathHasEdge(transition: AutomatonTransition): boolean {
  const inputSymbols = [...testInput.value];
  for (let index = 0; index < simulationStep; index++) {
    if (simulationPath[index] === transition.from && simulationPath[index + 1] === transition.to && inputSymbols[index] === transition.symbol) return true;
  }
  return false;
}

function renderGraph(): void {
  clearGraph();
  const automaton = currentAutomaton();
  if (!automaton) return;
  const positions = graphPositions(automaton);
  const visited = new Set(simulationPath.slice(0, simulationStep + 1));

  for (const transition of automaton.transitions) {
    const from = positions.get(transition.from)!;
    const to = positions.get(transition.to)!;
    const active = pathHasEdge(transition);
    let curve: THREE.QuadraticBezierCurve3;
    if (transition.from === transition.to) {
      curve = new THREE.QuadraticBezierCurve3(from, from.clone().add(new THREE.Vector3(0, 1.8, 0)), from.clone().add(new THREE.Vector3(0, 0.3, 0)));
    } else {
      const midpoint = from.clone().add(to).multiplyScalar(0.5);
      const direction = to.clone().sub(from);
      const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
      const duplicateCount = automaton.transitions.filter((edge) => edge.from === transition.from && edge.to === transition.to).length;
      const offset = duplicateCount > 1 ? (transition.symbol === automaton.alphabet[0] ? 0.55 : -0.55) : 0.14;
      curve = new THREE.QuadraticBezierCurve3(from, midpoint.add(perpendicular.multiplyScalar(offset)), to);
    }
    edgeCurves.push(curve);
    const points = curve.getPoints(36);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: active ? '#d36b4c' : '#9ca9a0', transparent: true, opacity: active ? 0.95 : 0.75 }));
    graphGroup.add(line);
    const tangent = curve.getTangent(0.96).normalize();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.32, 12), new THREE.MeshStandardMaterial({ color: active ? '#d36b4c' : '#84948a', roughness: 0.6 }));
    arrow.position.copy(curve.getPoint(0.96));
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    graphGroup.add(arrow);

    const labelElement = document.createElement('div');
    labelElement.className = `edge-label${active ? ' edge-label-active' : ''}`;
    labelElement.textContent = transition.symbol ?? 'ε';
    const label = new CSS2DObject(labelElement);
    label.position.copy(curve.getPoint(0.52));
    graphGroup.add(label);

    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), new THREE.MeshBasicMaterial({ color: '#d36b4c' }));
    particle.userData.curveIndex = edgeCurves.length - 1;
    particle.userData.offset = particles.length / Math.max(1, automaton.transitions.length);
    graphGroup.add(particle);
    particles.push(particle);
  }

  for (const state of automaton.states) {
    const active = visited.has(state);
    const final = automaton.finals.includes(state);
    const start = state === automaton.start;
    const fill = active ? '#d36b4c' : final ? '#76b9a0' : '#f7f8f2';
    const rim = start ? '#426e61' : active ? '#a64d38' : final ? '#4e937b' : '#9ba99f';
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(0.39, 32, 24),
      new THREE.MeshStandardMaterial({ color: fill, roughness: 0.36, metalness: 0.04, emissive: active ? '#6e2e1f' : '#000000', emissiveIntensity: active ? 0.26 : 0 }),
    );
    node.position.copy(positions.get(state)!);
    node.userData.baseY = node.position.y;
    graphGroup.add(node);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 36), new THREE.MeshBasicMaterial({ color: rim }));
    ring.position.copy(node.position);
    ring.rotation.x = Math.PI / 2;
    graphGroup.add(ring);
    if (final) {
      const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.018, 8, 36), new THREE.MeshBasicMaterial({ color: rim }));
      innerRing.position.copy(node.position);
      innerRing.rotation.x = Math.PI / 2;
      graphGroup.add(innerRing);
    }
    const labelElement = document.createElement('div');
    labelElement.className = `node-label${active ? ' node-label-active' : ''}`;
    labelElement.textContent = state;
    const label = new CSS2DObject(labelElement);
    label.position.copy(node.position).add(new THREE.Vector3(0, -0.74, 0));
    graphGroup.add(label);
    if (start) {
      const startLabel = document.createElement('div');
      startLabel.className = 'start-label';
      startLabel.textContent = 'START';
      const startTag = new CSS2DObject(startLabel);
      startTag.position.copy(node.position).add(new THREE.Vector3(0, 0.72, 0));
      graphGroup.add(startTag);
    }
  }

  const center = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(graphGroup);
  box.getCenter(center);
  controls.target.copy(center);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 5);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const verticalFit = span / (2 * Math.tan(halfFov));
  const horizontalFit = size.x / (2 * Math.tan(halfFov) * camera.aspect);
  camera.position.set(center.x, center.y, Math.max(9, verticalFit, horizontalFit) * 1.2);
  camera.near = 0.1;
  camera.far = Math.max(100, span * 8);
  camera.updateProjectionMatrix();
  controls.update();
  updateGraphMeta(automaton);
}

function updateGraphMeta(automaton: Automaton): void {
  const labels: Record<Stage, string> = { nfa: 'NFA', dfa: 'DFA', minimized: 'MINIMIZED DFA' };
  const descriptions: Record<Stage, string> = { nfa: 'Every path, before determinization', dfa: 'One state for each reachable subset', minimized: 'The smallest equivalent machine' };
  document.querySelector('#graph-stage-kicker')!.textContent = `STAGE 0${selectedStage === 'nfa' ? 1 : selectedStage === 'dfa' ? 2 : 3} / ${labels[selectedStage]}`;
  document.querySelector('#graph-title')!.textContent = descriptions[selectedStage];
  document.querySelector('#state-count')!.textContent = String(automaton.states.length).padStart(2, '0');
  document.querySelector('#graph-alphabet')!.textContent = `ALPHABET { ${automaton.alphabet.join(', ') || 'ε'} }`;
  document.querySelector('#graph-edge-count')!.textContent = `${automaton.transitions.length} TRANSITIONS`;
}

function renderTable(): void {
  const automaton = currentAutomaton();
  const wrap = document.querySelector<HTMLDivElement>('#transition-table')!;
  document.querySelector('#table-stage')!.textContent = selectedStage === 'minimized' ? 'MINIMIZED' : selectedStage.toUpperCase();
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
    pipeline = nextPipeline;
    selectedStage = 'minimized';
    simulationPath = [nextPipeline.minimized.start];
    simulationStep = 0;
    lastResult = null;
    message.textContent = `${nextPipeline.nfa.states.length} NFA → ${nextPipeline.dfa.states.length} DFA → ${nextPipeline.minimized.states.length} minimized`;
    message.className = 'compile-message is-success';
    document.querySelector('#graph-empty')!.setAttribute('hidden', '');
    syncStageTabs();
    renderGraph();
    renderTable();
    updateSimulation();
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
    selectedStage = button.dataset.stage as Stage;
    syncStageTabs();
    renderGraph();
    renderTable();
  });
});
document.querySelector<HTMLButtonElement>('#reset-camera')!.addEventListener('click', () => renderGraph());
document.querySelector<HTMLButtonElement>('#clear-button')!.addEventListener('click', resetSimulation);
document.querySelector<HTMLButtonElement>('#step-button')!.addEventListener('click', stepSimulation);
testInput.addEventListener('input', resetSimulation);
document.querySelector<HTMLButtonElement>('#run-button')!.addEventListener('click', async () => {
  if (!pipeline || isRunning) return;
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
  const width = graphMount.clientWidth;
  const height = graphMount.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);
  if (currentAutomaton()) renderGraph();
}
new ResizeObserver(resize).observe(graphMount);
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
