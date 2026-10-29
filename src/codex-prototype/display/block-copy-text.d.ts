export function createBlockText(plainMathText:(text:string)=>string):{
 blockSource(source:string,srcLine:(number|{from:number;to:number})[],map:[number,number]):string;
 blockPlainText(tokens:any[],openIndex:number):string;
 tsvToCsv(text:string):string;
};
