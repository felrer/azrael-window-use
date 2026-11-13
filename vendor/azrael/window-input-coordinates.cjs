'use strict';
// Public image/screen input contract; the native broker still receives explicit
// click/drag operations and physical screen pixels.
const native = require('./multi-pointer-mcp.cjs');
const { windowError } = require('./window-control-errors.cjs');
const reject = message => { throw windowError('invalid_request', message, { actionExecuted: false }); };
const coordinate = desktop => ({ type:'integer', minimum:desktop?-100000:0, maximum:desktop?100000:16383 });
const points = (desktop,min=1,max=32) => ({type:'array',minItems:min,maxItems:max,items:{type:'array',minItems:2,maxItems:2,items:coordinate(desktop)}});
function inputSchema(desktop=false) {
  const definitions=native.toolDefinitions();
  const operationId=definitions.find(d=>d.name==='click').inputSchema.properties.operationId;
  const click={type:'object',properties:{points:points(desktop,1,1),button:{type:'string',enum:['left','right','middle']},operationId},required:['points'],additionalProperties:false};
  const drag={type:'object',properties:{points:points(desktop,2,32),button:{type:'string',enum:['left']},durationMs:{type:'integer',minimum:50,maximum:2000},operationId},required:['points'],additionalProperties:false};
  const variants=definitions.filter(d=>['status','collaboration','scroll','press','text','batch'].includes(d.name)).map(d=>{
    const properties={action:{type:'string',enum:[d.name]},...structuredClone(d.inputSchema.properties)};
    delete properties.pointerId;delete properties.x;delete properties.y;
    properties.points=points(desktop,1,1);
    if(d.name==='batch') {
      const click=properties.steps.items.oneOf[0];
      delete click.properties.x;delete click.properties.y;click.properties.points=points(desktop,1,1);
    }
    const required=['action',...d.inputSchema.required.filter(k=>!['pointerId','x','y'].includes(k))];
    if(desktop||!['status','collaboration'].includes(d.name))required.push('points');
    return {type:'object',properties,required,additionalProperties:false};
  });
  return {oneOf:[click,drag,...variants]};
}
function normalizeInput(input,desktop=false) {
  try { native.validateArguments({inputSchema:inputSchema(desktop)},input); }
  catch(error) { reject(error.message); }
  const {points:anchors,...rest}=input;
  if(!input.action) {
    if(anchors.length===1)return {action:'click',button:'left',...rest,x:anchors[0][0],y:anchors[0][1]};
    if(anchors.every(p=>p[0]===anchors[0][0]&&p[1]===anchors[0][1]))reject('Drag requires at least two distinct points');
    const {button,...drag}=rest;
    return {action:'drag',...drag,points:anchors.map(p=>[...p])};
  }
  const out={...rest,...(anchors?{x:anchors[0][0],y:anchors[0][1]}:{})};
  if(out.action==='batch')out.steps=out.steps.map(step=>{
    const {points:p,...args}=step;
    return {...args,...(p?{x:p[0][0],y:p[0][1]}:{})};
  });
  return out;
}
function mapInput(packet,convert) {
  const out={...packet};
  if(Object.hasOwn(out,'x'))Object.assign(out,convert(out.x,out.y));
  if(out.points)out.points=out.points.map(([x,y])=>{const p=convert(x,y);return [p.x,p.y];});
  if(out.steps)out.steps=out.steps.map(step=>Object.hasOwn(step,'x')?{...step,...convert(step.x,step.y)}:{...step});
  return out;
}
const sameGeometry=(a,b)=>!!a&&!!b&&['originX','originY','widthPx','heightPx','dpi'].every(k=>a[k]===b[k]);
function imageToScreen(packet,geometry) {
  return mapInput(packet,(x,y)=>{
    if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<0||y<0||x>=geometry.widthPx||y>=geometry.heightPx)reject('Coordinates are outside the captured image');
    return {x:geometry.originX+x,y:geometry.originY+y};
  });
}
module.exports={inputSchema,normalizeInput,mapInput,sameGeometry,imageToScreen};
