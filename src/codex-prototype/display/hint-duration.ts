/** Original ui.hintSeconds policy; transient hints only, never approvals/recovery alerts. */
export function normalizeHintSeconds(raw:number){return Math.min(60,Math.max(1,Math.round(raw)));}
let seconds=4;
export function configureDisplayHints(settings:{hintSeconds?:number}){seconds=typeof settings.hintSeconds==='number'&&Number.isFinite(settings.hintSeconds)?normalizeHintSeconds(settings.hintSeconds):4;}
export function displayHintMs(){return seconds*1000;}
