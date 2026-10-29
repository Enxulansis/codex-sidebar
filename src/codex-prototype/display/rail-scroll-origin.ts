/** DSH165 actual-position/extent checks; dispatch delay never identifies user intent. */
export class RailScrollOrigin{
 private top=-1;private extent=-1;
 wrote(actualTop:number,actualExtent:number){this.top=actualTop;this.extent=actualExtent;}
 classify(actualTop:number,actualExtent:number):'self'|'clamp'|'input'{
  const own=Math.abs(actualTop-this.top)<1,clamp=this.extent>=0&&actualExtent!==this.extent&&(actualTop<=.5||actualTop>=actualExtent-.5);
  this.wrote(actualTop,actualExtent);return own?'self':clamp?'clamp':'input';
 }
}
