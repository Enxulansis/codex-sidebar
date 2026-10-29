import type {DraftFile} from './draft-store-types';
/** Local provenance for an actual public user message; text inclusion requires a matching public input. */
export type DisplayFile=DraftFile&{unavailable?:string;textIncluded?:boolean};
