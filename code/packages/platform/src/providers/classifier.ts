// Model boundary (AD-09, TRD 8.5). The model proposes; deterministic code decides. No real model call in B1.
export type ProposedTier = 'life_safety' | 'urgent' | 'uncertain' | 'routine';

export interface ClassifierInput {
  text: string | null;
  hasMedia: boolean;
}
export interface ClassifierAnswer {
  tier: ProposedTier;
  trade: string | null;
  confidence: number;
  missingFields: string[];
}
export interface Classifier {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassifierAnswer>;
}

export class ClassifierUnavailableError extends Error {
  override name = 'ClassifierUnavailableError';
}

/** Fake: `down` throws, `hang` never answers (the caller's timeout fires), otherwise returns `answer`. */
export class FakeClassifier implements Classifier {
  readonly provider = 'fake';
  readonly model = 'fake-model-1';
  readonly promptVersion = 'p0';
  mode: 'down' | 'hang' | 'answer' = 'answer';
  answer: ClassifierAnswer = { tier: 'routine', trade: 'general', confidence: 0.95, missingFields: [] };
  calls = 0;

  async classify(_input: ClassifierInput, signal: AbortSignal): Promise<ClassifierAnswer> {
    this.calls += 1;
    if (this.mode === 'down') throw new ClassifierUnavailableError('fake model down');
    if (this.mode === 'hang') {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    return { ...this.answer };
  }
}
