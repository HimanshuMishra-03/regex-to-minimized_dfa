export type AutomatonTransition = {
  from: string;
  to: string;
  symbol: string | null;
};

export type Automaton = {
  states: string[];
  start: string;
  finals: string[];
  alphabet: string[];
  transitions: AutomatonTransition[];
  stateDetails?: Record<string, string>;
};

export type StoryPhase = 'nfa' | 'dfa' | 'partition' | 'minimized';

export type VisualizationStep = {
  phase: StoryPhase;
  title: string;
  description: string;
  automaton: Automaton;
  focusStates: string[];
  focusTransitions: AutomatonTransition[];
  scrollStates?: string[];
  groups?: string[][];
};

export type AutomataPipeline = {
  nfa: Automaton;
  dfa: Automaton;
  minimized: Automaton;
  story: VisualizationStep[];
};

type NfaState = { id: number; transitions: AutomatonTransition[] };
type Fragment = { start: number; end: number };

const EPSILON = null;
const MAX_REGEX_LENGTH = 48;
const MAX_DFA_STATES = 128;

function isOperator(token: string): boolean {
  return token === '|' || token === '.' || token === '(' || token === ')' || token === '*' || token === '+' || token === '?';
}

function withConcatenation(regex: string): string[] {
  const tokens = [...regex.replace(/\s+/g, '')];
  const expanded: string[] = [];
  const canEnd = (token: string) => !['|', '.', '('].includes(token);
  const canStart = (token: string) => !['|', '.', ')', '*', '+', '?'].includes(token);

  for (const token of tokens) {
    const previous = expanded.at(-1);
    if (previous && canEnd(previous) && canStart(token)) expanded.push('.');
    expanded.push(token);
  }
  return expanded;
}

function toPostfix(regex: string): string[] {
  const output: string[] = [];
  const operators: string[] = [];
  const precedence: Record<string, number> = { '|': 1, '.': 2 };
  let expectingOperand = true;

  for (const token of withConcatenation(regex)) {
    if (!isOperator(token)) {
      if (!expectingOperand) throw new Error(`Missing operator before "${token}".`);
      output.push(token);
      expectingOperand = false;
      continue;
    }

    if (token === '(') {
      if (!expectingOperand) throw new Error('Missing operator before "(".');
      operators.push(token);
      expectingOperand = true;
    } else if (token === ')') {
      if (expectingOperand) throw new Error('Expected an expression before ")".');
      while (operators.length && operators.at(-1) !== '(') output.push(operators.pop()!);
      if (operators.pop() !== '(') throw new Error('Unmatched closing parenthesis.');
      expectingOperand = false;
    } else if (token === '*' || token === '+' || token === '?') {
      if (expectingOperand) throw new Error(`"${token}" needs an expression before it.`);
      output.push(token);
      expectingOperand = false;
    } else {
      if (expectingOperand) throw new Error(`Expected an expression before "${token}".`);
      while (operators.length && operators.at(-1) !== '(' && precedence[operators.at(-1)!] >= precedence[token]) {
        output.push(operators.pop()!);
      }
      operators.push(token);
      expectingOperand = true;
    }
  }

  if (expectingOperand) throw new Error('The expression ends before an operand.');
  while (operators.length) {
    const operator = operators.pop()!;
    if (operator === '(') throw new Error('Unmatched opening parenthesis.');
    output.push(operator);
  }
  if (!output.length) throw new Error('Enter a regular expression first.');
  return output;
}

function buildNfa(regex: string): { states: NfaState[]; start: number; final: number; alphabet: string[]; story: VisualizationStep[] } {
  const postfix = toPostfix(regex);
  const states: NfaState[] = [];
  const fragments: Fragment[] = [];
  const alphabet = new Set<string>();
  const story: VisualizationStep[] = [];
  const createState = () => {
    const id = states.length;
    states.push({ id, transitions: [] });
    return id;
  };
  const connect = (from: number, to: number, symbol: string | null) => {
    const transition = { from: `q${from}`, to: `q${to}`, symbol };
    states[from].transitions.push(transition);
    return transition;
  };
  const recordStep = (title: string, description: string, focusStates: string[], focusTransitions: AutomatonTransition[], scrollStates = focusStates) => {
    const currentStates = states.map((state) => `q${state.id}`);
    const currentTransitions = states.flatMap((state) => state.transitions);
    const currentStart = fragments[0]?.start ?? 0;
    story.push({
      phase: 'nfa',
      title,
      description,
      automaton: {
        states: currentStates,
        start: `q${currentStart}`,
        finals: fragments.map((fragment) => `q${fragment.end}`),
        alphabet: [...alphabet].sort(),
        transitions: [...currentTransitions],
      },
      focusStates,
      focusTransitions: [...focusTransitions],
      scrollStates,
    });
  };

  for (const token of postfix) {
    if (!['.', '|', '*', '+', '?'].includes(token)) {
      const start = createState();
      const end = createState();
      const transition = connect(start, end, token);
      alphabet.add(token);
      fragments.push({ start, end });
      recordStep(`Create symbol fragment "${token}"`, `Add q${start} --${token}--> q${end}. Every literal begins as a two-state NFA fragment.`, [`q${start}`, `q${end}`], [transition]);
    } else if (token === '.') {
      const right = fragments.pop();
      const left = fragments.pop();
      if (!left || !right) throw new Error('Concatenation is missing an expression.');
      const transition = connect(left.end, right.start, EPSILON);
      fragments.push({ start: left.start, end: right.end });
      recordStep('Join the fragments', `Connect q${left.end} to q${right.start} with ε. The left fragment flows directly into the right.`, [`q${left.end}`, `q${right.start}`], [transition]);
    } else if (token === '|') {
      const right = fragments.pop();
      const left = fragments.pop();
      if (!left || !right) throw new Error('Choice requires an expression on both sides.');
      const start = createState();
      const end = createState();
      const added = [
        connect(start, left.start, EPSILON),
        connect(start, right.start, EPSILON),
        connect(left.end, end, EPSILON),
        connect(right.end, end, EPSILON),
      ];
      fragments.push({ start, end });
      recordStep(`Add a choice fork for "|"`, `Create q${start} and q${end}. Epsilon branches enter either choice and merge at the new final state.`, [`q${start}`, `q${end}`, `q${left.start}`, `q${right.start}`], added, [`q${start}`, `q${left.start}`, `q${right.start}`]);
    } else {
      const operand = fragments.pop();
      if (!operand) throw new Error(`"${token}" is missing its expression.`);
      const start = createState();
      const end = createState();
      const added = [connect(start, operand.start, EPSILON), connect(operand.end, end, EPSILON)];
      if (token === '*' || token === '+') added.push(connect(operand.end, operand.start, EPSILON));
      if (token === '*' || token === '?') added.push(connect(start, end, EPSILON));
      fragments.push({ start, end });
      const operation = token === '*' ? 'Kleene star' : token === '+' ? 'One-or-more loop' : 'Optional path';
      recordStep(`Wrap the fragment with ${operation}`, `Add q${start} and q${end}; epsilon edges ${token === '*' ? 'allow zero or repeated passes' : token === '+' ? 'allow repeated passes after the first' : 'allow either skipping or taking the fragment'}.`, [`q${start}`, `q${end}`, `q${operand.start}`, `q${operand.end}`], added);
    }
  }

  if (fragments.length !== 1) throw new Error('The expression could not be reduced to one automaton.');
  const fragment = fragments[0];
  return { states, start: fragment.start, final: fragment.end, alphabet: [...alphabet].sort(), story };
}

function epsilonClosure(seed: Iterable<number>, states: NfaState[]): number[] {
  const closure = new Set(seed);
  const pending = [...closure];
  while (pending.length) {
    const state = pending.pop()!;
    for (const transition of states[state].transitions) {
      if (transition.symbol === EPSILON) {
        const target = Number(transition.to.slice(1));
        if (!closure.has(target)) {
          closure.add(target);
          pending.push(target);
        }
      }
    }
  }
  return [...closure].sort((a, b) => a - b);
}

function subsetKey(subset: number[]): string {
  return subset.join(',');
}

function stateName(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return `S${index - 26}`;
}

function formatNfaSet(states: number[]): string {
  return states.length ? `{ ${states.map((state) => `q${state}`).join(', ')} }` : '∅';
}

function makeDfa(nfa: ReturnType<typeof buildNfa>): { automaton: Automaton; story: VisualizationStep[] } {
  const subsets: number[][] = [epsilonClosure([nfa.start], nfa.states)];
  const indices = new Map<string, number>([[subsetKey(subsets[0]), 0]]);
  const transitions: AutomatonTransition[] = [];
  const story: VisualizationStep[] = [];
  const stateDetails: Record<string, string> = { A: formatNfaSet(subsets[0]) };
  const recordStep = (title: string, description: string, focusStates: string[], focusTransitions: AutomatonTransition[]) => {
    story.push({
      phase: 'dfa',
      title,
      description,
      automaton: {
        states: subsets.map((_, index) => stateName(index)),
        start: stateName(0),
        finals: subsets.flatMap((subset, index) => subset.includes(nfa.final) ? [stateName(index)] : []),
        alphabet: nfa.alphabet,
        transitions: [...transitions],
        stateDetails: { ...stateDetails },
      },
      focusStates,
      focusTransitions,
    });
  };

  recordStep('Take the start epsilon-closure', `The DFA start state A represents ε-closure({ q${nfa.start} }) = ${formatNfaSet(subsets[0])}.`, ['A'], []);

  for (let cursor = 0; cursor < subsets.length; cursor++) {
    if (subsets.length > MAX_DFA_STATES) throw new Error(`This expression creates more than ${MAX_DFA_STATES} DFA states. Try a shorter expression.`);
    for (const symbol of nfa.alphabet) {
      const moved = new Set<number>();
      for (const state of subsets[cursor]) {
        for (const transition of nfa.states[state].transitions) {
          if (transition.symbol === symbol) moved.add(Number(transition.to.slice(1)));
        }
      }
      const target = epsilonClosure(moved, nfa.states);
      const key = subsetKey(target);
      let targetIndex = indices.get(key);
      if (targetIndex === undefined) {
        targetIndex = subsets.length;
        indices.set(key, targetIndex);
        subsets.push(target);
        stateDetails[stateName(targetIndex)] = formatNfaSet(target);
      }
      const transition = { from: stateName(cursor), to: stateName(targetIndex), symbol };
      transitions.push(transition);
      recordStep(
        `Compute ${stateName(cursor)} on "${symbol}"`,
        `move(${formatNfaSet(subsets[cursor])}, "${symbol}") reaches ${formatNfaSet([...moved].sort((left, right) => left - right))}; its epsilon-closure is ${formatNfaSet(target)}, named ${stateName(targetIndex)}.`,
        [stateName(cursor), stateName(targetIndex)],
        [transition],
      );
    }
  }

  return { automaton: {
    states: subsets.map((_, index) => stateName(index)),
    start: stateName(0),
    finals: subsets.flatMap((subset, index) => subset.includes(nfa.final) ? [stateName(index)] : []),
    alphabet: nfa.alphabet,
    transitions,
    stateDetails,
  }, story };
}

function minimize(dfa: Automaton): { automaton: Automaton; story: VisualizationStep[] } {
  const stateIndex = new Map(dfa.states.map((state, index) => [state, index]));
  const finalSet = new Set(dfa.finals);
  const story: VisualizationStep[] = [];
  let groups = [
    dfa.states.map((_, index) => index).filter((index) => finalSet.has(dfa.states[index])),
    dfa.states.map((_, index) => index).filter((index) => !finalSet.has(dfa.states[index])),
  ].filter((group) => group.length);

  const targetFor = (state: string, symbol: string) => dfa.transitions.find((edge) => edge.from === state && edge.symbol === symbol)?.to;
  const groupNames = (partition: number[][]) => partition.map((group) => group.map((index) => dfa.states[index]));
  const recordPartition = (title: string, description: string, partition: number[][], focusStates: string[]) => {
    story.push({
      phase: 'partition',
      title,
      description,
      automaton: dfa,
      focusStates,
      focusTransitions: [],
      groups: groupNames(partition),
    });
  };

  recordPartition(
    'Separate accepting from non-accepting states',
    `Start with final states { ${dfa.finals.join(', ') || 'none'} } and non-final states { ${dfa.states.filter((state) => !finalSet.has(state)).join(', ') || 'none'} }.`,
    groups,
    [...dfa.finals, ...dfa.states.filter((state) => !finalSet.has(state))],
  );

  while (true) {
    const groupOf = new Map<number, number>();
    groups.forEach((group, groupIndex) => group.forEach((state) => groupOf.set(state, groupIndex)));
    const refined: number[][] = [];
    let splitDescription = '';

    for (const group of groups) {
      const buckets = new Map<string, number[]>();
      for (const index of group) {
        const state = dfa.states[index];
        const signature = dfa.alphabet.map((symbol) => {
          const target = targetFor(state, symbol);
          return target === undefined ? -1 : groupOf.get(stateIndex.get(target)!) ?? -1;
        }).join(',');
        const bucket = buckets.get(signature) ?? [];
        bucket.push(index);
        buckets.set(signature, bucket);
      }
      if (!splitDescription && buckets.size > 1) {
        const [firstBucket, secondBucket] = [...buckets.values()];
        const firstState = firstBucket[0];
        const secondState = secondBucket[0];
        const splitSymbol = dfa.alphabet.find((symbol) => {
          const firstTarget = targetFor(dfa.states[firstState], symbol);
          const secondTarget = targetFor(dfa.states[secondState], symbol);
          const firstGroup = firstTarget === undefined ? -1 : groupOf.get(stateIndex.get(firstTarget)!);
          const secondGroup = secondTarget === undefined ? -1 : groupOf.get(stateIndex.get(secondTarget)!);
          return firstGroup !== secondGroup;
        });
        splitDescription = `${dfa.states[firstState]} and ${dfa.states[secondState]} must separate${splitSymbol ? ` because on "${splitSymbol}" they reach different groups` : ' because their transition signatures differ'}.`;
      }
      refined.push(...buckets.values());
    }

    if (refined.length === groups.length) {
      recordPartition('The partition is stable', 'No group can be split further: every state in a group transitions to the same groups for every symbol.', groups, groups.flat().map((index) => dfa.states[index]));
      break;
    }
    groups = refined;
    recordPartition('Refine the partitions', splitDescription, groups, groups.flat().map((index) => dfa.states[index]));
  }

  groups.sort((left, right) => left.includes(0) ? -1 : right.includes(0) ? 1 : Math.min(...left) - Math.min(...right));
  const minimizedNames = groups.map((_, index) => stateName(index));
  const groupOf = new Map<number, number>();
  groups.forEach((group, groupIndex) => group.forEach((state) => groupOf.set(state, groupIndex)));
  const transitions: AutomatonTransition[] = [];
  const stateDetails: Record<string, string> = {};
  const minimizedStart = minimizedNames[groupOf.get(stateIndex.get(dfa.start)!)!];

  groups.forEach((group, groupIndex) => {
    const name = minimizedNames[groupIndex];
    const members = group.map((state) => dfa.states[state]);
    stateDetails[name] = `{ ${members.join(', ')} }`;
    const states = minimizedNames.slice(0, groupIndex + 1);
    story.push({
      phase: 'minimized',
      title: `Merge ${members.join(', ')} into ${name}`,
      description: `${members.join(', ')} are equivalent, so they become one minimized state, ${name}.`,
      automaton: {
        states,
        start: minimizedStart,
        finals: groups.slice(0, groupIndex + 1).flatMap((candidate, index) => candidate.some((state) => finalSet.has(dfa.states[state])) ? [minimizedNames[index]] : []),
        alphabet: dfa.alphabet,
        transitions: [...transitions],
        stateDetails: { ...stateDetails },
      },
      focusStates: [name],
      focusTransitions: [],
    });
  });

  groups.forEach((group, groupIndex) => {
    const representative = dfa.states[group[0]];
    for (const symbol of dfa.alphabet) {
      const target = targetFor(representative, symbol);
      if (target !== undefined) {
        const transition = { from: minimizedNames[groupIndex], to: minimizedNames[groupOf.get(stateIndex.get(target)!)!], symbol };
        transitions.push(transition);
        story.push({
          phase: 'minimized',
          title: `Add ${transition.from} on "${symbol}" to ${transition.to}`,
          description: `The representative ${representative} moves to ${target} on "${symbol}"; their equivalence groups become ${transition.from} → ${transition.to}.`,
          automaton: {
            states: minimizedNames,
            start: minimizedStart,
            finals: groups.flatMap((candidate, index) => candidate.some((state) => finalSet.has(dfa.states[state])) ? [minimizedNames[index]] : []),
            alphabet: dfa.alphabet,
            transitions: [...transitions],
            stateDetails: { ...stateDetails },
          },
          focusStates: [transition.from, transition.to],
          focusTransitions: [transition],
        });
      }
    }
  });

  return { automaton: {
    states: minimizedNames,
    start: minimizedStart,
    finals: groups.flatMap((group, index) => group.some((state) => finalSet.has(dfa.states[state])) ? [minimizedNames[index]] : []),
    alphabet: dfa.alphabet,
    transitions,
    stateDetails,
  }, story };
}

function asNfa(nfa: ReturnType<typeof buildNfa>): Automaton {
  return {
    states: nfa.states.map((state) => `q${state.id}`),
    start: `q${nfa.start}`,
    finals: [`q${nfa.final}`],
    alphabet: nfa.alphabet,
    transitions: nfa.states.flatMap((state) => state.transitions),
  };
}

export function compileRegex(regex: string): AutomataPipeline {
  if (regex.length > MAX_REGEX_LENGTH) throw new Error(`Keep the expression under ${MAX_REGEX_LENGTH + 1} characters.`);
  const nfa = buildNfa(regex);
  const dfa = makeDfa(nfa);
  const minimized = minimize(dfa.automaton);
  return {
    nfa: asNfa(nfa),
    dfa: dfa.automaton,
    minimized: minimized.automaton,
    story: [...nfa.story, ...dfa.story, ...minimized.story],
  };
}

export function simulate(automaton: Automaton, input: string): { path: string[]; accepted: boolean; error?: string } {
  const path = [automaton.start];
  let current = automaton.start;
  for (const symbol of input) {
    if (!automaton.alphabet.includes(symbol)) {
      return { path, accepted: false, error: `"${symbol}" is not in the alphabet { ${automaton.alphabet.join(', ')} }.` };
    }
    const transition = automaton.transitions.find((edge) => edge.from === current && edge.symbol === symbol);
    if (!transition) return { path, accepted: false, error: `No transition from ${current} on "${symbol}".` };
    current = transition.to;
    path.push(current);
  }
  return { path, accepted: automaton.finals.includes(current) };
}
