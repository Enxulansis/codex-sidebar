import type {ImageMime} from './image-formats';
/** A bounded read of the current workspace file, never a historical upload or send attachment. */
export type ReferenceImageSource={name:string;mime:ImageMime;base64:string;size:number;sha256:string;animated:boolean};
