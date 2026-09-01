import React, { FormEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CircleHelp,
  LoaderCircle,
  Send,
  ShieldCheck,
  Volume2,
  X
} from 'lucide-react';
import { safeFetchJson } from '../../lib/api';
import './SupportAssistant.css';

interface SupportSource {
  id: string;
  title: string;
  section?: string;
  kind: 'faq' | 'catalog';
}

interface SupportMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  spokenText?: string;
  sources?: SupportSource[];
  mode?: 'faq' | 'llm-grounded' | 'not-found';
}

interface SupportAssistantProps {
  open: boolean;
  onClose: () => void;
}

const welcomeMessage: SupportMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Olá! Posso ajudar com o uso do ATEM Field, reservas, agenda e checklists aprovados. Para uma dúvida técnica, informe o equipamento, fabricante, modelo e código de erro.',
  spokenText: 'Olá! Posso ajudar com o uso do ATEM Field, reservas, agenda e checklists aprovados.',
  sources: [{ id: 'atem-overview', title: 'FAQ curada do ATEM Field', section: 'Visão geral', kind: 'faq' }],
  mode: 'faq'
};

function messageHistory(messages: SupportMessage[]) {
  return messages
    .filter(message => message.id !== 'welcome')
    .slice(-8)
    .map(message => ({ role: message.role, content: message.content }));
}

export const SupportAssistant: React.FC<SupportAssistantProps> = ({ open, onClose }) => {
  const [messages, setMessages] = useState<SupportMessage[]>([welcomeMessage]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechRequestIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.speechSynthesis?.cancel();
      speechRequestIdRef.current += 1;
      audioRef.current?.pause();
      audioRef.current = null;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setSpeakingId(null);
      document.removeEventListener('keydown', onKeyDown);
      window.setTimeout(() => document.getElementById('support-open-button')?.focus(), 0);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const cleanQuestion = question.replace(/\s+/g, ' ').trim();
    if (!cleanQuestion || sending) return;

    const userMessage: SupportMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: cleanQuestion
    };
    setMessages(current => [...current, userMessage]);
    setQuestion('');
    setError('');
    setSending(true);

    try {
      const response = await safeFetchJson('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: cleanQuestion,
          history: messageHistory(messages)
        })
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Não foi possível consultar o assistente.');
      }

      const assistantMessage: SupportMessage = {
        id: response.requestId || `assistant-${Date.now()}`,
        role: 'assistant',
        content: String(response.answer || 'Não encontrei uma resposta aprovada para essa dúvida.'),
        spokenText: String(response.spokenSummary || response.answer || '').slice(0, 280),
        sources: Array.isArray(response.sources) ? response.sources : [],
        mode: response.mode
      };
      setMessages(current => [...current, assistantMessage]);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'O assistente está temporariamente indisponível.');
    } finally {
      setSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const readAloud = async (message: SupportMessage) => {
    const requestId = speechRequestIdRef.current + 1;
    speechRequestIdRef.current = requestId;
    if (speakingId === message.id) {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      audioRef.current = null;
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      setSpeakingId(null);
      return;
    }

    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    const spokenText = (message.spokenText || message.content).slice(0, 280);
    setError('');
    setSpeakingId(message.id);

    // Use Gemini TTS when configured, but keep browser speech as a zero-cost
    // fallback for unsupported browsers, quota exhaustion, or network errors.
    try {
      const response = await safeFetchJson('/api/support/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spokenText })
      });
      if (requestId !== speechRequestIdRef.current) return;
      if (response?.success && typeof response.audioBase64 === 'string') {
        const binary = atob(response.audioBase64);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: response.mimeType || 'audio/wav' }));
        const audio = new Audio(url);
        audioRef.current = audio;
        audioUrlRef.current = url;
        const finish = () => {
          if (audioRef.current !== audio) return;
          audioRef.current = null;
          if (audioUrlRef.current === url) {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
          }
          setSpeakingId(null);
        };
        audio.onended = finish;
        audio.onerror = finish;
        await audio.play();
        return;
      }
    } catch {
      // Fall through to the browser-native voice.
    }

    if (requestId !== speechRequestIdRef.current) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeakingId(null);
      setError('A leitura de voz não está disponível neste navegador.');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.98;
    utterance.onstart = () => setSpeakingId(message.id);
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="support-assistant-overlay" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="support-assistant-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-assistant-title"
      >
        <header className="support-assistant-header">
          <div className="support-assistant-heading">
            <span className="support-assistant-mark" aria-hidden="true"><CircleHelp size={20} /></span>
            <div>
              <span className="support-assistant-eyebrow">Ajuda ATEM</span>
              <h2 id="support-assistant-title">Assistente de suporte</h2>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="support-assistant-close"
            onClick={onClose}
            aria-label="Fechar assistente de suporte"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </header>

        <div className="support-assistant-trust" role="note">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>Respostas baseadas em fontes aprovadas. O assistente não altera registros.</span>
        </div>

        <div className="support-assistant-messages" aria-live="polite" aria-label="Conversa com o assistente">
          {messages.map(message => (
            <article key={message.id} className={`support-message support-message--${message.role}`}>
              <div className="support-message-bubble">
                <p>{message.content}</p>
                {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                  <div className="support-message-sources">
                    <span className="support-message-sources-label"><BookOpen size={13} aria-hidden="true" /> Fontes</span>
                    {message.sources.map(source => (
                      <span key={`${message.id}-${source.id}`} className="support-source-chip">
                        {source.title}{source.section ? ` · ${source.section}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {message.role === 'assistant' && (
                  <div className="support-message-actions">
                    <button
                      type="button"
                      className="support-message-voice"
                      onClick={() => readAloud(message)}
                      aria-pressed={speakingId === message.id}
                    >
                      <Volume2 size={14} aria-hidden="true" />
                      {speakingId === message.id ? 'Parar leitura' : 'Ouvir resumo'}
                    </button>
                  </div>
                )}
              </div>
              {message.role === 'assistant' && message.mode === 'not-found' && (
                <span className="support-message-meta"><AlertCircle size={13} aria-hidden="true" /> Fonte não encontrada</span>
              )}
            </article>
          ))}
          {sending && (
            <article className="support-message support-message--assistant">
              <div className="support-message-bubble support-message-bubble--loading" aria-label="Consultando fontes aprovadas">
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                <span>Consultando fontes aprovadas…</span>
              </div>
            </article>
          )}
        </div>

        <div className="support-assistant-footer">
          {error && (
            <div className="support-assistant-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Fechar aviso"><X size={14} /></button>
            </div>
          )}
          <div className="support-assistant-capability-note">
            <Volume2 size={14} aria-hidden="true" />
            <span>Voz Google gratuita quando disponível; leitura nativa do navegador permanece como fallback.</span>
          </div>
          <form className="support-assistant-form" onSubmit={submitQuestion}>
            <label htmlFor="support-assistant-question">Sua pergunta</label>
            <div className="support-assistant-input-row">
              <textarea
                ref={inputRef}
                id="support-assistant-question"
                value={question}
                onChange={event => setQuestion(event.target.value.slice(0, 1000))}
                placeholder="Ex.: onde encontro o checklist do monitor?"
                rows={2}
                maxLength={1000}
                disabled={sending}
              />
              <button
                type="submit"
                className="support-assistant-send"
                disabled={sending || !question.trim()}
                aria-label="Enviar pergunta"
                title="Enviar pergunta"
              >
                {sending ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
              </button>
            </div>
            <div className="support-assistant-form-meta">
              <span>Não inclua PINs, senhas ou dados de pacientes.</span>
              <span>{question.length}/1000</span>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default SupportAssistant;
