import PptxGenJS from "pptxgenjs";
import type { Block, PresentationContent } from "@deckai/contracts";
import { imageDataUrl, type RenderAssets } from "@deckai/renderer";

const Presentation = PptxGenJS as unknown as typeof PptxGenJS.default;

export async function renderPptx(content: PresentationContent, title: string, assets: RenderAssets = {}): Promise<Buffer> {
  const deck = new Presentation();deck.layout="LAYOUT_WIDE";deck.title=title;
  for(const source of content.slides){
    const slide=deck.addSlide();const dark=["cover","closing","metrics"].includes(source.layout);
    slide.background={color:source.layout==="closing"?"244F53":dark?"1A4248":"F8F6F2"};
    const color=dark?"FFFFFF":"172D38",muted=dark?"C5DED8":"63767A";
    const titleBlock=source.blocks.find(block=>block.type==="text"&&block.role==="title");
    const rest=source.blocks.filter(block=>block!==titleBlock);
    const images=rest.filter(block=>block.type==="image"),copy=rest.filter(block=>block.type!=="image");
    const add=(block:Block,x:number,y:number,w:number,h:number)=>{
      if(block.type==="image"){
        const asset=block.assetId?assets[block.assetId]:undefined;const data=imageDataUrl(asset);
        if(block.assetId&&(!asset||!data))throw new Error("EXPORT_IMAGE_MISSING");
        if(asset&&data){const scale=Math.min(w/asset.width,h/asset.height);const iw=asset.width*scale,ih=asset.height*scale;slide.addImage({data,x:x+(w-iw)/2,y:y+(h-ih)/2,w:iw,h:ih,altText:block.alt});}
        else slide.addText("Selecione uma imagem",{x,y,w,h,fontSize:14,color:muted,align:"center",valign:"middle",margin:0});
      }else if(block.type==="metric"){
        slide.addText(block.value+(block.unit?" "+block.unit:""),{x,y,w,h:h*.57,fontFace:"Arial",fontSize:38,bold:true,color,margin:0,fit:"shrink"});
        slide.addText(block.label,{x,y:y+h*.6,w,h:h*.4,fontFace:"Arial",fontSize:16,color:muted,margin:0,fit:"shrink"});
      }else slide.addText(block.text,{x,y,w,h,fontFace:"Arial",fontSize:block.role==="title"?(["cover","closing"].includes(source.layout)?53:42):block.role==="subtitle"?22:18,bold:["title","subtitle"].includes(block.role),color:block.role==="title"?color:muted,margin:0,fit:"shrink",valign:"middle",breakLine:false});
    };
    const stack=(blocks:Block[],x:number,y:number,w:number,h:number)=>{
      const row=h/Math.max(1,blocks.length);for(const [i,block]of blocks.entries())add(block,x,y+i*row,w,row*.9);
    };
    if(["cover","closing","text_image"].includes(source.layout)){
      const w=images.length?6.1:11.2;
      if(titleBlock)add(titleBlock,.9,1.1,w,2.1);
      stack(copy,.9,3.5,w,2.7);stack(images,7.6,1.1,4.9,5.3);
    }else{
      if(titleBlock)add(titleBlock,.85,.65,11.6,1.2);
      if(source.layout==="two_columns"){
        const mid=Math.ceil(rest.length/2);stack(rest.slice(0,mid),1.1,2.3,5.2,4.1);stack(rest.slice(mid),7.0,2.3,5.2,4.1);
      }else if(source.layout==="metrics"){
        const metrics=rest.filter(block=>block.type==="metric"),others=rest.filter(block=>block.type!=="metric");stack(others,.9,2,11.3,1.0);
        const columns=Math.min(3,Math.max(1,metrics.length)),rows=Math.ceil(metrics.length/columns),w=11.4/columns,h=3.2/Math.max(1,rows);
        metrics.forEach((block,i)=>add(block,.9+(i%columns)*w,3.3+Math.floor(i/columns)*h,w-.25,h-.15));
      }else{stack(copy,.9,2.2,images.length?6.1:11.4,4.1);stack(images,7.6,2.2,4.8,4.1);}
    }
  }
  return Buffer.from(await deck.write({outputType:"nodebuffer"}) as Buffer);
}
