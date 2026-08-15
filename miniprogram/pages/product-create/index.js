const productService = require("../../services/product");
const { toProductPayload } = require("../../utils/product-form");
const { scanBarcode } = require("../../utils/scan-barcode");
const { withAuth } = require("../../utils/auth-page");

const EMPTY_PRODUCT = { name:"", unit:"", supplier:"", imageFileID:"", shelfLocation:"", remark:"" };
let variantSeed = 0;
const emptyVariant = (barcode="") => ({ _key:`new-${Date.now()}-${variantSeed += 1}`, specification:"", costPrice:"", salePrice:"", stock:"0", warningStock:"", barcode });

Page(withAuth({
  data:{ product:{...EMPTY_PRODUCT}, variants:[emptyVariant()], hasVariants:false, unitPresets:["个","件","袋","包","瓶","盒","卷","套","米","斤"], submitting:false, uploading:false },
  onLoad(options) {
    const barcode = options && options.barcode ? decodeURIComponent(options.barcode) : "";
    if (barcode) this.setData({ variants:[emptyVariant(barcode)] });
  },
  onProductInput(e) { this.setData({ [`product.${e.currentTarget.dataset.field}`]:e.detail.value }); },
  onProductSuggestion(e) { this.setData({ [`product.${e.currentTarget.dataset.field}`]:e.detail.value }); },
  onVariantInput(e) { this.setData({ [`variants[${e.currentTarget.dataset.index}].${e.currentTarget.dataset.field}`]:e.detail.value }); },
  onVariantSuggestion(e) { this.setData({ [`variants[${e.currentTarget.dataset.index}].specification`]:e.detail.value }); },
  toggleVariants(e) {
    const hasVariants = e.detail.value;
    const variants = hasVariants
      ? this.data.variants
      : [{ ...this.data.variants[0], specification:"" }];
    this.setData({ hasVariants, variants });
  },
  addVariant() { this.setData({ variants:this.data.variants.concat(emptyVariant()) }); },
  removeVariant(e) {
    if (this.data.variants.length <= 1) return;
    const variants = this.data.variants.filter((_, index) => index !== e.currentTarget.dataset.index);
    this.setData({ variants });
  },
  copyPrevious(e) {
    const index = e.currentTarget.dataset.index;
    if (index < 1) return;
    const previous = this.data.variants[index - 1];
    this.setData({ [`variants[${index}].costPrice`]:previous.costPrice, [`variants[${index}].salePrice`]:previous.salePrice, [`variants[${index}].warningStock`]:previous.warningStock });
  },
  applyPricesToAll(e) {
    const source = this.data.variants[e.currentTarget.dataset.index];
    const variants = this.data.variants.map((item) => ({ ...item, costPrice:source.costPrice, salePrice:source.salePrice }));
    this.setData({ variants });
  },
  async scanVariantBarcode(e) {
    const barcode = await scanBarcode();
    if (barcode) this.setData({ [`variants[${e.currentTarget.dataset.index}].barcode`]:barcode });
  },
  async chooseImage() {
    try {
      const selected=await wx.chooseMedia({count:1,mediaType:["image"]}); this.setData({uploading:true});
      const uploaded=await wx.cloud.uploadFile({cloudPath:`products/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,filePath:selected.tempFiles[0].tempFilePath});
      this.setData({"product.imageFileID":uploaded.fileID});
    } catch(error) { if(!String(error.errMsg||error.message).includes("cancel")) wx.showToast({title:"图片上传失败",icon:"none"}); }
    finally { this.setData({uploading:false}); }
  },
  submit(){return this.save(false);},
  submitAndContinue(){return this.save(true);},
  async save(continueCreating) {
    if(this.data.submitting||this.data.uploading)return;
    let payload;
    try { payload=toProductPayload(this.data.product,this.data.variants,this.data.hasVariants,true); }
    catch(error) { wx.showToast({title:error.message,icon:"none"});return; }
    this.setData({submitting:true});
    try {
      const result=await productService.createProduct(payload);
      if(!continueCreating){wx.showToast({title:"创建成功"});setTimeout(()=>wx.redirectTo({url:`/pages/product-detail/index?id=${result.product._id}`}),500);return;}
      const {supplier,unit,shelfLocation}=this.data.product;
      this.setData({product:{...EMPTY_PRODUCT,supplier,unit,shelfLocation},variants:[emptyVariant()],hasVariants:false});
      wx.pageScrollTo({scrollTop:0,duration:0});wx.showToast({title:"已保存，请录入下一件"});
    } catch(error){wx.showToast({title:error.message,icon:"none"});}
    finally{this.setData({submitting:false});}
  },
}));
