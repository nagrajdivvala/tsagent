// File: src/main.tsx
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import {
  define,
  jsx,
  time,
  Respond,
  RedirectToAvailableTopics,
  DetectAbuse,
  Hooks,
  Topic,
} from "@sierra/agent";
import { WithContactCenterPlugin } from "@sierra/plugins/contact-center/contact-center-agent";
import { plugin } from "./contact-center-agent";
import { content } from "./content-types";
import { ContactCenterProvider } from "@sierra/plugins/contact-center/hooks";
import { AuthenticateMember } from "./skills/authenticate";
import AcmeIVRIntentTriage from "./AcmeIVRIntentTriage";
import { VoiceGreeting, onVoiceCheck } from "./voice";

const main = define(
  WithContactCenterPlugin(plugin, {
    brand: ({ info }) => {
      const [today] = time.now(info.timeZone || "America/New_York").split("T");
      return {
        organizationName: content.brand?.organizationName || "Acme Corp",
        agentName: content.brand?.agentName || "Acme Assistant",
        languageGuidance: `${content.brand?.languageGuidance || ""}\n\nToday is ${today}.`,
      };
    },
    jsx: {
      unhandledIntentFallback: <HandleUnhandledIntent />,
    },
    config: {
      voiceConfig: {
        enabledEvents: ["start", "inactivity"],
        inactivityTimeoutSeconds: 15,
      },
    },
    onVoiceCheck,
    onClientEvent: ({ conversation, event, generateAgentResponse }) => {
      switch (event.type) {
        case "start":
          if (conversation.info.isVoice) {
            generateAgentResponse(<VoiceGreeting />, jsx.newEmptyState());
          }
          break;
        case "message":
          generateAgentResponse(
            <ContactCenterProvider plugin={plugin}>
              <DetectAbuse mode={content.errors?.abuseDetectionMode || "observe"}>
                <AuthenticateMember>
                  <AcmeIVRIntentTriage query={event.message.content.trim()} />
                </AuthenticateMember>
              </DetectAbuse>
            </ContactCenterProvider>
          );
          break;
        case "inactivity":
          if (conversation.info.isVoice) {
            generateAgentResponse(
              <Respond mode="paraphrase">
                Are you still there? Let me know how I can help.
              </Respond>,
              jsx.newEmptyState()
            );
          }
          break;
        case "request-complete":
          conversation.output.send({ type: "complete", reason: "Requested" });
          break;
      }
    },
    onError: ({ event, generateAgentResponse }) => {
      if (event.type === "message") {
        generateAgentResponse(
          <Respond mode="verbatim">
            Oops, something went wrong. Transferring you to an agent now.
          </Respond>,
          jsx.newEmptyState()
        );
      }
    },
    onPostConversation: Hooks.use({
      detectUpsetUser: { enabled: content.errors?.detectUpsetUser },
      detectRepetition: { enabled: content.errors?.detectRepetition },
    }),
  })
);

export default main;

function HandleUnhandledIntent() {
  return (
    <RedirectToAvailableTopics>
      <Topic>General Assistance</Topic>
    </RedirectToAvailableTopics>
  );
}


// File: src/agent.tsx
import { jsx, GoalAgent, Respond, ResponsePhrasing } from "@sierra/agent";
import { content } from "./content-types";
import AcmeIVRIntentTriage from "./AcmeIVRIntentTriage";

export function Agent() {
  return (
    <GoalAgent>
      <ResponsePhrasing content={content.brand?.languageGuidance || ""} />
      <AcmeIVRIntentTriage query="" />
    </GoalAgent>
  );
}


// File: src/contact-center-agent.ts
import { ContactCenterPlugin } from "@sierra/plugins/contact-center";
import { content } from "./content-types";
import type { ContactCenterIntegrationSettings } from "@sierra/plugins/contact-center/contact-center-settings";

export const plugin = ContactCenterPlugin(
  content.contactCenterIntegration as ContactCenterIntegrationSettings
);


// File: src/voice.tsx
import { jsx, env, Respond, type VoiceCheckOutput } from "@sierra/agent";
import { content } from "./content-types";

export function VoiceGreeting() {
  const greeting = content.voice?.voiceGreeting?.trim();
  return (
    <Respond mode="verbatim">
      {greeting ||
        `Hello! You’ve reached Acme Corp Virtual Assistant. How can I help you today?`}
    </Respond>
  );
}

export function onVoiceCheck(): VoiceCheckOutput {
  const webAccess = content.voice?.webAccess;
  return {
    voiceInputSupported:
      webAccess === "on" || (webAccess === "staging" && env.name !== "production"),
    persona: content.voice?.persona,
  };
}


// File: src/skills/authenticate.tsx
import { jsx, useState } from "@sierra/agent";
import { Prompt, Respond } from "@sierra/agent";

/**
 * Authentication flow: mocks validation using multiple user records.
 */
export function AuthenticateMember({ children }: { children: JSX.Element }) {
  const VALID_USERS = [
    { memberId: "123456", dob: "01/01/1980" },
    { memberId: "654321", dob: "12/31/1975" },
    { memberId: "ABCDEF", dob: "07/04/1990" },
    { memberId: "XYZ123", dob: "10/10/1985" },
  ];

  const [memberId, setMemberId] = useState<string | null>(null);
  const [dob, setDob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ask for Member ID
  if (!memberId) {
    return (
      <>
        {error && <Respond mode="paraphrase">{error}</Respond>}
        <Prompt
          question="Please enter your Member ID."
          onSubmit={({ trim }) => {
            setMemberId(trim());
            setError(null);
          }}
        />
      </>
    );
  }

  // Ask for DOB
  if (!dob) {
    return (
      <>
        {error && <Respond mode="paraphrase">{error}</Respond>}
        <Prompt
          question="Please enter your Date of Birth (MM/DD/YYYY)."
          onSubmit={({ trim }) => {
            setDob(trim());
            setError(null);
          }}
        />
      </>
    );
  }

  // Validate credentials against mock list
  const valid = VALID_USERS.some(
    user => user.memberId === memberId && user.dob === dob
  );

  if (!valid) {
    // Reset and show error
    setMemberId(null);
    setDob(null);
    setError("Invalid credentials. Please try again.");
    return null; // rerun prompts
  }

  // Proceed once validated
  return children;
}


// File: src/AcmeIVRIntentTriage.tsx
import { jsx, Respond, Triage, Category, RedirectToAvailableTopics } from "@sierra/agent";

export default function AcmeIVRIntentTriage({ query }: { query: string }) {
  return (
    <Triage
      context="Acme IVR Intent Classification"
      otherwise={
        <Respond mode="paraphrase">
          I’m sorry, I didn’t quite catch that. Could you please rephrase?
        </Respond>
      }
      fewShotCases={[
        { input: "What’s covered by my benefits?", categoryId: "benefit-inquiry" },
        { input: "Where is my claim?", categoryId: "claims-status" },
        { input: "Do I need prior authorization?", categoryId: "prior-authorization" },
        { input: "I want to book an appointment", categoryId: "appointment-scheduling" },
      ]}
      experimentalDisableDefaultFewShots={false}
      exceptions={[
        {
          id: "transfer",
          descriptions: [
            "I want to speak to a representative",
            "live agent",
            "customer service",
          ],
          actionMode: "reset",
          action: <RedirectToAvailableTopics />,
        },
      ]}
      excludeExceptions={false}
      stuckOptions={{
        maxAttempts: 2,
        action: (
          <Respond mode="paraphrase">
            It seems we’re not making progress—let me connect you to an agent.
          </Respond>
        ),
      }}
    >
      <Category descriptions={["Ask about benefit details", "benefit inquiry", "coverage details"]}>
        <Respond mode="paraphrase">
          It looks like you’re asking about benefit details. How can I assist you further?
        </Respond>
      </Category>

      <Category descriptions={["Check claim status", "claim status", "status of my claim"]}>
        <Respond mode="paraphrase">
          You’d like to check your claim status. Can you provide your claim number?
        </Respond>
      </Category>

      <Category descriptions={["Prior authorization inquiry", "prior auth", "authorization status"]}>
        <Respond mode="paraphrase">
          Let’s talk about prior authorization. What’s the authorization reference?
        </Respond>
      </Category>

      <Category descriptions={["Schedule an appointment", "book appointment", "appointment scheduling"]}>
        <Respond mode="paraphrase">
          I can help schedule an appointment. When would you like to meet?
        </Respond>
      </Category>
    </Triage>
  );
}
