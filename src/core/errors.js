'use strict';

// `safe` marks a message as free of provider text, paths or credentials, so it may be
// shown to the operator verbatim. Anything unmarked is replaced by a generic string:
// provider errors routinely echo request bodies and headers.
class AgentUsageError extends Error {
  constructor(message) { super(message); this.code = 'USAGE'; this.safe = true; }
}

/** The provider is absent or unusable before any request was made. */
class AgentProviderUnavailable extends Error {
  constructor(message) { super(message); this.code = 'PROVIDER_UNAVAILABLE'; this.safe = true; }
}

/** The provider ran but the turn failed. Message is authored here, never echoed from it. */
class AgentProviderError extends Error {
  constructor(message) { super(message); this.code = 'PROVIDER_FAILED'; this.safe = true; }
}

/** The provider returned content that does not satisfy the requested schema. */
class AgentSchemaError extends Error {
  constructor(message) { super(message); this.code = 'PROVIDER_SCHEMA'; this.safe = true; }
}

function toSafeJson(error) {
  return {
    error: error.safe ? error.message : 'Operation refused or failed; inspect local prerequisites and draft gates.',
    code: error.code === 'USAGE' ? 'USAGE' : (error.code || 'FAILED')
  };
}

function exitCodeFor(error) { return error.code === 'USAGE' ? 2 : 1; }

module.exports = {
  AgentUsageError,
  AgentProviderUnavailable,
  AgentProviderError,
  AgentSchemaError,
  toSafeJson,
  exitCodeFor
};
