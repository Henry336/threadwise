# Voice Notes to Clean Notes

Reviewed against backend v0.32.0: **2026-08-10**

Voice transcription is a Threadwise Capture feature. It is separate from Ideas Intelligence.

## Telegram flow

1. Send a Telegram voice message. Threadwise immediately acknowledges that transcription started.
2. Threadwise downloads and validates the audio, then calls OpenAI's transcription API.
3. The exact API transcript is stored as the raw transcript.
4. In `light` mode, Threadwise only adds punctuation and paragraph breaks and removes obvious filler or repeated false starts. A conservative validation guard falls back to the exact raw transcript if cleanup fails, changes numbers, returns empty text, or changes the length too aggressively.
5. The result is saved as a normal searchable Threadwise Note.
6. The result card offers **Open note**, **View raw transcript**, **Undo**, **Edit**, and **Keep verbatim**.

Long raw transcripts are paginated without altering their content. Undo archives the generated note but retains the capture record and raw transcript.

## Settings

Use the **Voice Capture** panel under `/settings`, or:

```text
/settings voice cleanup light
/settings voice cleanup verbatim
/settings voice model fast
/settings voice model accuracy
/settings voice language en
/settings voice language auto
/settings voice audio on
/settings voice audio off
```

The default model is `gpt-4o-mini-transcribe`. The accuracy option uses `gpt-4o-transcribe`. The optional language hint is an ISO-639-1 two-letter code. Telegram voice messages are always eligible; ordinary supported audio files are automatic only when the audio setting is on.

Supported OpenAI upload formats are FLAC, MP3, MP4, MPEG/MPGA, M4A, OGG, WAV, and WebM.

## Environment

```text
OPENAI_API_KEY=...
VOICE_TRANSCRIPTION_MAX_BYTES=20000000
VOICE_TRANSCRIPTION_LEASE_SECONDS=300
```

OpenAI's transcription API accepts uploads up to 25 MB. Telegram's standard hosted Bot API currently allows bots to download files up to 20 MB, so Threadwise defaults to 20,000,000 bytes and never permits a value above 25,000,000 bytes.

## Reliability and privacy

`VoiceTranscriptionJob` stores Telegram file metadata, selected settings, exact raw text, cleaned text, note linkage, errors, delivery state, leases, attempts, and timestamps. `(telegramChatId, telegramMessageId)` is unique, making duplicate Telegram updates idempotent.

The raw transcript is persisted before cleanup and note creation. Note creation and final job linkage happen in one database transaction. Expired `PROCESSING` leases are recovered after restart, and undelivered completion/failure messages are retried.

Private chats use their normal Threadwise user scope. Groups continue to use existing Telegram addressing rules and the shared group-workspace user; transcript callbacks additionally require the exact workspace user and exact Telegram chat, preventing cross-chat access.

Audio bytes exist only in process memory while being sent to OpenAI. Threadwise does not store the downloaded audio in PostgreSQL or on disk.
