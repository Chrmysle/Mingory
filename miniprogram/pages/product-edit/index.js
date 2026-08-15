const productService=require("../../services/product");
const {toProductPayload}=require("../../utils/product-form");
const {formatCent}=require("../../utils/money");
const {withAuth}=require("../../utils/auth-page");
const {scanBarcode}=require("../../utils/scan-barcode");

Page(withAuth({
  data:{product:null,variants:[],hasVariants:false,unitPresets:["个","件","袋","包","瓶","盒","卷","套","米","斤"],loading:true,submitting:false,uploading:false,error:""},
  onLoad(options){this.productId=options.id;this.load();},
  onProductInput(e){this.setData({[`product.${e.currentTarget.dataset.field}`]:e.detail.value});},
  onProductSuggestion(e){this.setData({[`product.${e.currentTarget.dataset.field}`]:e.detail.value});},
  onVariantInput(e){this.setData({[`variants[${e.currentTarget.dataset.index}].${e.currentTarget.dataset.field}`]:e.detail.value});},
  onVariantSuggestion(e){this.setData({[`variants[${e.currentTarget.dataset.index}].specification`]:e.detail.value});},
  onVariantEnabled(e){this.setData({[`variants[${e.currentTarget.dataset.index}].enabled`]:e.detail.value});},
  async load(){
    try{
      const data=await productService.getProduct({productId:this.productId});
      const product={...data.product};
      const variants=data.variants.map((item)=>({_id:item._id,specification:item.specification||"",costPrice:formatCent(item.costPriceCent),salePrice:formatCent(item.salePriceCent),warningStock:item.warningStock==null?"":String(item.warningStock),barcode:item.barcode||"",enabled:item.enabled!==false,stock:item.stock,variantCode:item.variantCode}));
      this.setData({product,variants,hasVariants:product.hasVariants===true});
    }catch(error){this.setData({error:error.message});}finally{this.setData({loading:false});}
  },
  async scanVariantBarcode(e){const barcode=await scanBarcode();if(barcode)this.setData({[`variants[${e.currentTarget.dataset.index}].barcode`]:barcode});},
  copyPrevious(e){const index=e.currentTarget.dataset.index;if(index<1)return;const previous=this.data.variants[index-1];this.setData({[`variants[${index}].costPrice`]:previous.costPrice,[`variants[${index}].salePrice`]:previous.salePrice,[`variants[${index}].warningStock`]:previous.warningStock});},
  applyPricesToAll(e){const source=this.data.variants[e.currentTarget.dataset.index];this.setData({variants:this.data.variants.map((item)=>({...item,costPrice:source.costPrice,salePrice:source.salePrice}))});},
  async chooseImage(){try{const selected=await wx.chooseMedia({count:1,mediaType:["image"]});this.setData({uploading:true});const uploaded=await wx.cloud.uploadFile({cloudPath:`products/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,filePath:selected.tempFiles[0].tempFilePath});this.setData({"product.imageFileID":uploaded.fileID});}catch(error){if(!String(error.errMsg||error.message).includes("cancel"))wx.showToast({title:"图片上传失败",icon:"none"});}finally{this.setData({uploading:false});}},
  async submit(){
    if(this.data.submitting||this.data.uploading)return;
    let payload;
    try{payload=toProductPayload(this.data.product,this.data.variants,this.data.hasVariants,false);}
    catch(error){wx.showToast({title:error.message,icon:"none"});return;}
    this.setData({submitting:true});
    try{await productService.updateProduct({productId:this.productId,product:payload.product,variants:payload.variants});wx.showToast({title:"保存成功"});setTimeout(()=>wx.navigateBack(),500);}catch(error){wx.showToast({title:error.message,icon:"none"});}finally{this.setData({submitting:false});}
  },
}));
