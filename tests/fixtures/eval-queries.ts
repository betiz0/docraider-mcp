/**
 * Evaluation query fixtures for semantic search testing
 * Contains query-result pairs that test paraphrase/ synonym matching
 * Based on spec Assumptions evaluation set
 */

export interface EvalQuery {
  query: string;
  expectedMatchTerms: string[]; // Terms that should match conceptually
  language: 'en' | 'ja';
  description: string;
}

export const evalQueries: EvalQuery[] = [
  // English paraphrase queries
  {
    query: 'authentication methods',
    expectedMatchTerms: ['authorization', 'login', 'credentials', 'identity verification'],
    language: 'en',
    description: 'English: "authentication" should match documents about "authorization", "login"',
  },
  {
    query: 'how to reset password',
    expectedMatchTerms: ['change password', 'recover account', 'forgot password', 'credential reset'],
    language: 'en',
    description: 'English: "reset password" should match "change password", "recover account"',
  },
  {
    query: 'API rate limiting',
    expectedMatchTerms: ['throttling', 'request limits', 'quota', 'rate limit'],
    language: 'en',
    description: 'English: "rate limiting" should match "throttling", "request limits"',
  },
  {
    query: 'database connection pooling',
    expectedMatchTerms: ['connection pool', 'DB pool', 'connection management', 'pool configuration'],
    language: 'en',
    description: 'English: "connection pooling" should match "connection pool"',
  },
  // Japanese paraphrase queries
  {
    query: '認証方法',
    expectedMatchTerms: ['ログイン', '認可', 'ID検証', 'パスワード'],
    language: 'ja',
    description: 'Japanese: "認証" should match "ログイン", "認可"',
  },
  {
    query: 'パスワードのリセット方法',
    expectedMatchTerms: ['パスワード変更', 'アカウント回復', 'パスワード紛失'],
    language: 'ja',
    description: 'Japanese: "パスワードリセット" should match "パスワード変更"',
  },
  {
    query: 'APIレートリミット',
    expectedMatchTerms: ['レート制限', 'リクエスト制限', 'クォータ'],
    language: 'ja',
    description: 'Japanese: "レートリミット" should match "レート制限"',
  },
];

/**
 * Get queries by language
 */
export function getQueriesByLanguage(language: 'en' | 'ja'): EvalQuery[] {
  return evalQueries.filter((q) => q.language === language);
}

/**
 * Get a subset of queries for quick testing
 */
export function getQuickEvalQueries(count = 3): EvalQuery[] {
  return evalQueries.slice(0, count);
}
