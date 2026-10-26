// Only presentation state; playback/lyrics/audio collectors remain independent.
class Visibility {
  constructor({prepare,show,hide,changed}) {
    Object.assign(this,{prepare,show,hide,changed});
    this.visible=true;this.serial=0;this.held=false;
  }
  async set(visible,reason) {
    this.visible=visible;const serial=++this.serial;
    if(!visible)this.hide();
    this.changed(visible,reason,serial);
    if(visible){await this.prepare(serial);if(this.visible&&this.serial===serial)this.show();}
  }
  toggle(reason){return this.set(!this.visible,reason)}
  shortcut(){if(this.held)return;this.held=true;this.heldAt=Date.now();return this.toggle('shortcut')}
  released(at){if(at==null || at>this.heldAt)this.held=false}
}
module.exports={Visibility};
