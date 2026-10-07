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
};

export type AutomataPipeline = {
  nfa: Automaton;
  dfa: Automaton;
  minimized: Automaton;
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

function buildNfa(regex: string): { states: NfaState[]; start: number; final: number; alphabet: string[] } {
  const postfix = toPostfix(regex);
  const states: NfaState[] = [];
  const fragments: Fragment[] = [];
  const alphabet = new Set<string>();
  const createState = () => {
    const id = states.length;
    states.push({ id, transitions: [] });
    return id;
  };
  const connect = (from: number, to: number, symbol: string | null) => {
    states[from].transitions.push({ from: `q${from}`, to: `q${to}`, symbol });
  };

  for (const token of postfix) {
    if (!['.', '|', '*', '+', '?'].includes(token)) {
      const start = createState();
      const end = createState();
      connect(start, end, token);
      alphabet.add(token);
      fragments.push({ start, end });
    } else if (token === '.') {
      const right = fragments.pop();
      const left = fragments.pop();
      if (!left || !right) throw new Error('Concatenation is missing an expression.');
      connect(left.end, right.start, EPSILON);
      fragments.push({ start: left.start, end: right.end });
    } else if (token === '|') {
      const right = fragments.pop();
      const left = fragments.pop();
      if (!left || !right) throw new Error('Choice requires an expression on both sides.');
      const start = createState();
      const end = createState();
      connect(start, left.start, EPSILON);
      connect(start, right.start, EPSILON);
      connect(left.end, end, EPSILON);
      connect(right.end, end, EPSILON);
      fragments.push({ start, end });
    } else {
      const operand = fragments.pop();
      if (!operand) throw new Error(`"${token}" is missing its expression.`);
      const start = createState();
      const end = createState();
      connect(start, operand.start, EPSILON);
      connect(operand.end, end, EPSILON);
      if (token === '*' || token === '+') connect(operand.end, operand.start, EPSILON);
      if (token === '*' || token === '?') connect(start, end, EPSILON);
      fragments.push({ start, end });
    }
  }

  if (fragments.length !== 1) throw new Error('The expression could not be reduced to one automaton.');
  const fragment = fragments[0];
  return { states, start: fragment.start, final: fragment.end, alphabet: [...alphabet].sort() };
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

function makeDfa(nfa: ReturnType<typeof buildNfa>): Automaton {
  const subsets: number[][] = [epsilonClosure([nfa.start], nfa.states)];
  const indices = new Map<string, number>([[subsetKey(subsets[0]), 0]]);
  const transitions: AutomatonTransition[] = [];

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
      }
      transitions.push({ from: stateName(cursor), to: stateName(targetIndex), symbol });
    }
  }

  return {
    states: subsets.map((_, index) => stateName(index)),
    start: stateName(0),
    finals: subsets.flatMap((subset, index) => subset.includes(nfa.final) ? [stateName(index)] : []),
    alphabet: nfa.alphabet,
    transitions,
  };
}

function minimize(dfa: Automaton): Automaton {
  const stateIndex = new Map(dfa.states.map((state, index) => [state, index]));
  const finalSet = new Set(dfa.finals);
  let groups = [
    dfa.states.map((_, index) => index).filter((index) => finalSet.has(dfa.states[index])),
    dfa.states.map((_, index) => index).filter((index) => !finalSet.has(dfa.states[index])),
  ].filter((group) => group.length);

  const targetFor = (state: string, symbol: string) => dfa.transitions.find((edge) => edge.from === state && edge.symbol === symbol)?.to;
  while (true) {
    const groupOf = new Map<number, number>();
    groups.forEach((group, groupIndex) => group.forEach((state) => groupOf.set(state, groupIndex)));
    const refined: number[][] = [];

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
      refined.push(...buckets.values());
    }

    if (refined.length === groups.length) break;
    groups = refined;
  }

  groups.sort((left, right) => left.includes(0) ? -1 : right.includes(0) ? 1 : Math.min(...left) - Math.min(...right));
  const minimizedNames = groups.map((_, index) => stateName(index));
  const groupOf = new Map<number, number>();
  groups.forEach((group, groupIndex) => group.forEach((state) => groupOf.set(state, groupIndex)));
  const transitions: AutomatonTransition[] = [];

  groups.forEach((group, groupIndex) => {
    const representative = dfa.states[group[0]];
    for (const symbol of dfa.alphabet) {
      const target = targetFor(representative, symbol);
      if (target !== undefined) {
        transitions.push({ from: minimizedNames[groupIndex], to: minimizedNames[groupOf.get(stateIndex.get(target)!)!], symbol });
      }
    }
  });

  return {
    states: minimizedNames,
    start: minimizedNames[groupOf.get(0)!],
    finals: groups.flatMap((group, index) => group.some((state) => finalSet.has(dfa.states[state])) ? [minimizedNames[index]] : []),
    alphabet: dfa.alphabet,
    transitions,
  };
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
  return { nfa: asNfa(nfa), dfa, minimized: minimize(dfa) };
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
