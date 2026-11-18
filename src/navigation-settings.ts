import { byId as $ } from './dom';
import { t } from './i18n';
import { icon, iconControl } from './icons';
import { PREFERENCE, readPreference, writePreference } from './preferences';

/**
 * The navigation switches kept as device preferences: the start notice,
 * automatic recalculation and spoken directions, each with its checkboxes
 * in the start notice and Settings, plus the speech itself.
 */

/** How long the "Automatic recalculation on" chip stays at start, ms. */
const AUTO_REROUTE_NOTICE = 10000;

// Device preferences, 'off' after "Don't show this notice again" or when the
// traveler turns automatic recalculation off; absent means on.
export const noticeWanted = () =>
  readPreference(PREFERENCE.navigationNotice) !== 'off';
export const rememberNotice = (show: boolean) =>
  writePreference(PREFERENCE.navigationNotice, show ? null : 'off');
const voiceWanted = () => readPreference(PREFERENCE.navigationVoice) === 'on';
const rememberVoice = (on: boolean) =>
  writePreference(PREFERENCE.navigationVoice, on ? 'on' : null);
const autoRerouteWanted = () =>
  readPreference(PREFERENCE.autoReroute) !== 'off';
const rememberAutoReroute = (on: boolean) =>
  writePreference(PREFERENCE.autoReroute, on ? null : 'off');

export function navigationSwitches(deps: {
  locale: () => string;
  screen: HTMLDialogElement;
}) {
  // Automatic recalculation, on unless the traveler turns it off: in the
  // start notice, in Settings or from the chip shown at start when the notice
  // is hidden, so travelers on a fixed course can follow it exactly.
  const autoNotice = $<HTMLInputElement>('nav-notice-reroute'),
    autoSetting = $<HTMLInputElement>('auto-reroute-setting'),
    autoChip = $('nav-auto-reroute');
  let autoReroute = autoRerouteWanted(),
    autoChipTimer = 0;
  const setAutoReroute = (on: boolean) => {
    autoReroute = on;
    rememberAutoReroute(on);
    autoNotice.checked = autoSetting.checked = on;
    if (!on) hideAutoChip();
  };
  function hideAutoChip() {
    clearTimeout(autoChipTimer);
    autoChip.hidden = true;
  }
  autoNotice.checked = autoSetting.checked = autoReroute;
  autoNotice.onchange = () => setAutoReroute(autoNotice.checked);
  autoSetting.onchange = () => setAutoReroute(autoSetting.checked);
  /** Speaks English source text in the interface language, if voice is on. */
  function say(text: string | null) {
    if (!text || !voiceOn || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(t(text));
    utterance.lang = deps.locale();
    speechSynthesis.speak(utterance);
  }
  function silence() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  // Spoken directions (#190), off by default: the start notice, Settings and
  // a button on the navigation screen turn them on or off.
  const voiceNotice = $<HTMLInputElement>('nav-notice-voice'),
    voiceSetting = $<HTMLInputElement>('voice-setting'),
    voiceButton = $<HTMLButtonElement>('nav-voice');
  let voiceOn = voiceWanted();
  const showVoice = () => {
    voiceNotice.checked = voiceSetting.checked = voiceOn;
    iconControl(
      voiceButton,
      voiceOn ? 'volume' : 'volume-off',
      voiceOn ? 'Voice on' : 'Voice off',
      true,
    );
    voiceButton.setAttribute('aria-pressed', String(voiceOn));
  };
  const setVoice = (on: boolean) => {
    voiceOn = on;
    rememberVoice(on);
    if (!on) silence();
    showVoice();
  };
  showVoice();
  voiceNotice.onchange = () => setVoice(voiceNotice.checked);
  voiceSetting.onchange = () => setVoice(voiceSetting.checked);
  voiceButton.onclick = () => {
    setVoice(!voiceOn);
    // A tap lets iOS speak; it also says the switch worked.
    if (voiceOn) say('Voice on');
  };
  $('nav-auto-reroute-off').onclick = () => {
    setAutoReroute(false);
    deps.screen.focus({ preventScroll: true });
  };
  autoChip.prepend(icon('route'));

  return {
    autoReroute: () => autoReroute,
    say,
    silence,
    hideAutoChip,
    /** The start notice opens with the current choice. */
    syncNotice() {
      autoNotice.checked = autoReroute;
    },
    /** The notice was skipped: a chip says recalculation is on, for a while. */
    remindAutoReroute() {
      if (!autoReroute) return;
      autoChip.hidden = false;
      autoChipTimer = window.setTimeout(hideAutoChip, AUTO_REROUTE_NOTICE);
    },
  };
}
