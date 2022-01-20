odoo.define('mis_builder.ListView', function (require) {
    "use strict";
    
    var View = require('web.View');
    
    var ListView = View.include({
        do_show: function () {
            this._super();

            if(this.ViewManager && this.ViewManager.action && this.ViewManager.action.target == 'new') {
                
                this.pager = false;
                this.render_pager(this.ViewManager.$el, {});
                
                if(this.pager){
                    this.pager.$el.css({
                        'text-align':'right',
                        'padding': '4px'
                    });
                }
   
            }
        }})
    
    return ListView;
});