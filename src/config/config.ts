import dotenv from 'dotenv';

dotenv.config();

const port = Number(process.env.PORT ?? 3040);
const cooldownSeconds = Number(process.env.COOLDOWN_SECONDS ?? 60);

const geminiEnabled = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
const groqEnabled = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
const openrouterEnabled = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0);
const nvidiaEnabled = Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0);

const config = {
  server: {
    port
  },
  router: {
    cooldownSeconds
  },
  providers: {
    gemini: { enabled: geminiEnabled, priority: 100 },
    groq: { enabled: groqEnabled, priority: 90 },
    openrouter: { enabled: openrouterEnabled, priority: 80 },
    nvidia: { enabled: nvidiaEnabled, priority: 95 }
  },
  errorClassification: {
    FATAL: [401, 403],
    RETRYABLE: [429],
    TIMEOUT: [408, 502, 503, 504],
    BAD_REQUEST: [400],
    UNKNOWN: []
  }
};

export default config;
