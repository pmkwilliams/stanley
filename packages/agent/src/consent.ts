/** Whether the user asked for what pressing a button that commits does: Jev's go-ahead, asked only then. */
export type Consent = 'asked' | 'not asked'

export const CONSENT: Record<Consent, string> = {
  asked: 'The user asked for what pressing it does: to send it (asking to reply, message or post with words they gave is asking to send them), or to post, pay, buy, book or delete it. Any words you wrote yourself, the user has heard and said to go ahead with.',
  'not asked': "The user didn't ask for that yet: they asked to draft, write or get something ready, only described what they want, haven't said, or haven't heard words you wrote yourself and said to go ahead.",
}

export const consentInstructions = (option: string) => `You are about to press [${option}]. Did the user ask for what it does?`
