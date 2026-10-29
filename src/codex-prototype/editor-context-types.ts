/** Display metadata only. A source key never authorizes a caller-supplied filesystem path. */
export type EditorSource={key:string;path:string;name:string;version:number};
export type EditorContextView={revision:number;enabled:boolean|null;saving:boolean;reason:string;source?:EditorSource};
