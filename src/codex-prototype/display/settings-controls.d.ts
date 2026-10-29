export function createSettingsControls():{
 settingsSection(title:string):HTMLElement;
 settingsRow(label:string,hint:string|undefined,control?:HTMLElement,warn?:boolean):HTMLElement;
 settingsSwitch(current:boolean,onToggle:(value:boolean)=>void):HTMLElement;
 settingsEnum(current:string,options:string[][],onPick:(value:string)=>void):HTMLElement;
 settingsColorPicker(current:string,onCommit:(value:string)=>void):HTMLElement;
 settingsNumber(current:number,min:number,max:number,onCommit:(value:number)=>void,step?:number,norm?:(value:number)=>number):HTMLElement;
 close():void;dispose():void;
};
