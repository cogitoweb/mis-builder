/* Copyright 2014-2019 ACSONE SA/NV (<http://acsone.eu>)
   License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl.html). */

odoo.define("mis_builder.widget", function (require) {
    "use strict";

    var AbstractField = require("web.AbstractField");
    var StandaloneFieldManagerMixin = require("web.StandaloneFieldManagerMixin");
    var field_registry = require("web.field_registry");
    var relational_fields = require("web.relational_fields");
    var BasicModel = require("web.BasicModel");

    var core = require("web.core");
    var session = require("web.session");

    var _t = core._t;

    var MisReportWidget = AbstractField.extend(StandaloneFieldManagerMixin, {
        template: "MisReportWidgetTemplate",

        events: _.extend({}, AbstractField.prototype.events, {
            "click .mis_builder_drilldown": "drilldown",
            "click .oe_mis_builder_print": "printPdf",
            "click .oe_mis_builder_export": "exportXls",
            "click .oe_mis_builder_settings": "displaySettings",
            "click .oe_mis_builder_refresh": "refresh",
        }),

        init: function () {
            var self = this;
            self._super.apply(self, arguments);
            StandaloneFieldManagerMixin.init.call(self);
            self.model = new BasicModel(self); // For FieldManagerMixin
            self.analytic_account_id_domain = []; // TODO unused for now
            self.analytic_account_id_label = _t("Analytic Account Filter");
            self.analytic_account_id_m2o = undefined; // Field widget
            self.analytic_group_id_domain = []; // TODO unused for now
            self.analytic_group_filter_name = "analytic_account_id.group_id";
            self.analytic_group_id_label = _t("Analytic Account Group");
            self.analytic_group_id_m2o = undefined; // Field widget
            self.analytic_tag_ids_domain = []; // TODO unused for now
            self.analytic_tag_ids_label = _t("Analytic Tags Filter");
            self.analytic_tag_ids_m2m = undefined; // Field widget

            self.partner_id_domain = []; // TODO unused for now
            self.partner_id_label = _t("Partner Filter");
            self.partner_id_m2o = undefined; // Field widget
            self.account_id_domain = []; // TODO unused for now
            self.account_id_label = _t("Account Filter");
            self.account_id_m2o = undefined; // Field widget

            self.mis_report_data = undefined;
            self.show_settings = false;
            self.has_group_analytic_accounting = false;
            self.has_group_analytic_tags = false;
            self.hide_analytic_filter = false;
            self.hide_analytic_group_filter = false;
            self.hide_partner_filter = false;
            self.hide_account_filter = false;
            self.additional_filters = [];
            self.additional_m2o = [];
        },

        _getFilterValue: function (name) {
            var filters = this.getParent().state.context.mis_report_filters || {};
            var filter = filters[name] || {};
            return filter.value;
        },

        _setFilterValue: function (name, value, operator) {
            var context = this.getParent().state.context;
            var filters = undefined;
            if (context.mis_report_filters === undefined) {
                filters = {};
                context.mis_report_filters = filters;
            } else {
                filters = context.mis_report_filters;
            }
            if (value === undefined) {
                filters[name] = {};
                return;
            }
            filters[name] = {
                value: value,
                operator: operator,
            };
        },

        /**
         * Return the id of the mis.report.instance to which the widget is
         * bound.
         *
         * @returns int
         */
        _instanceId: function () {
            if (this.value) {
                return this.value;
            }

            /*
             * This trick is needed because in a dashboard the view does
             * not seem to be bound to an instance: it seems to be a limitation
             * of Odoo dashboards that are not designed to contain forms but
             * rather tree views or charts.
             */
            var context = this.getParent().state.context;
            if (context.active_model === "mis.report.instance") {
                return context.active_id;
            }
        },

        /**
         * Method called between @see init and @see start. Performs asynchronous
         * calls required by the rendering and the start method.
         *
         * @returns Promise
         */
        willStart: function () {
            var self = this;
            var context = self.getParent().state.context;

            var def1 = self
                ._rpc({
                    model: "mis.report.instance",
                    method: "compute",
                    args: [self._instanceId()],
                    context: context,
                })
                .then(function (result) {
                    self.mis_report_data = result;
                });

            var def2 = session
                .user_has_group("account.group_account_user")
                .then(function (result) {
                    self.show_settings = result;
                });

            var def3 = session
                .user_has_group("analytic.group_analytic_accounting")
                .then(function (result) {
                    self.has_group_analytic_accounting = result;
                });

            var def4 = session
                .user_has_group("analytic.group_analytic_tags")
                .then(function (result) {
                    self.has_group_analytic_tags = result;
                });

            var def5 = self
                ._rpc({
                    model: "mis.report.instance",
                    method: "read",
                    args: [self._instanceId(), ["hide_analytic_filter", "hide_analytic_group_filter", "hide_partner_filter", "hide_account_filter"]],
                    context: context,
                })
                .then(function (result) {
                    self.hide_analytic_filter = result[0].hide_analytic_filter;
                    self.hide_analytic_group_filter = result[0].hide_analytic_group_filter;
                    self.hide_partner_filter = result[0].hide_partner_filter;
                    self.hide_account_filter = result[0].hide_account_filter;
                });

            var def6 = self
                ._rpc({
                    model: "mis.report.instance.filter",
                    method: "search_read",
                    fields: [
                        "model_name", "field_name", "model_descr", "sequence", "custom_descr", "domain"
                    ],
                    domain: [['report_instance_id', '=', self._instanceId()]],
                    sort: "sequence asc",
                    context: context,
                })
                .then(function (result) {
                    self.additional_filters = result;
                });

            return $.when(
                this._super.apply(this, arguments),
                def1,
                def2,
                def3,
                def4,
                def5,
                def6
            );
        },

        start: function () {
            var self = this;
            self._super.apply(self, arguments);
            self._addAnalyticFilters();
            self._addPartnerFilter();
            self._addAccountFilter();
            self._addAdditionalFilter();
        },

        /**
         * Create list of field descriptors to be provided
         * to BasicModel.makeRecord.
         *
         * @returns list of objects
         */
        _getFilterFields: function () {
            var self = this;
            var fields = [];
            if (self.has_group_analytic_accounting) {

                if (!self.hide_analytic_filter) {
                    fields.push({
                        relation: "account.analytic.account",
                        type: "many2one",
                        name: "filter_analytic_account_id",
                        value: self._getFilterValue("analytic_account_id"),
                    });
                }

                if (!self.hide_analytic_group_filter) {
                    fields.push({
                        relation: "account.analytic.group",
                        type: "many2one",
                        name: "filter_analytic_account_id.group_id",
                        value: self._getFilterValue("analytic_account_id.group_id"),
                    });
                }
            }
            if (self.has_group_analytic_tags) {
                fields.push({
                    relation: "account.analytic.tag",
                    type: "many2many",
                    name: "filter_analytic_tag_ids",
                    value: self._getFilterValue("analytic_tag_ids"),
                });
            }
            return fields;
        },

        _getPartnerField: function () {
            var self = this;
            var fields = [];

            fields.push({
                relation: "res.partner",
                type: "many2one",
                name: "filter_partner_id",
                value: self._getFilterValue("partner_id"),
            });

            return fields;
        },

        _getAccountField: function () {
            var self = this;
            var fields = [];

            fields.push({
                relation: "account.account",
                type: "many2one",
                name: "filter_account_id",
                value: self._getFilterValue("account_id"),
            });

            return fields;
        },

        /**
         * Create fieldInfo structure to be provided
         * to BasicModel.makeRecord.
         *
         * @returns object
         */
        _getFilterFieldInfo: function () {
            return {};
        },

        /**
         * Create analytic filter widgets and add them in the filter box.
         *
         * @param {Object} record @see BasicModel.makeRecord
         */
        _makeFilterFieldWidgets: function (record) {
            var self = this;

            if (self.has_group_analytic_accounting) {

                if (!self.hide_analytic_filter) {
                    self.analytic_account_id_m2o = new relational_fields.FieldMany2One(
                        self,
                        "filter_analytic_account_id",
                        record,
                        {
                            mode: "edit",
                            attrs: {
                                placeholder: self.analytic_account_id_label,
                                options: {
                                    no_create: "True",
                                    no_open: "True",
                                },
                            },
                        }
                    );
                    self._registerWidget(
                        record.id,
                        self.analytic_account_id_m2o.name,
                        self.analytic_account_id_m2o
                    );
                    self.analytic_account_id_m2o.appendTo(self.getMisBuilderFilterBox());
                }

                if (!self.hide_analytic_group_filter) {
                    self.analytic_group_id_m2o = new relational_fields.FieldMany2One(
                        self,
                        "filter_analytic_account_id.group_id",
                        record,
                        {
                            mode: "edit",
                            attrs: {
                                placeholder: self.analytic_group_id_label,
                                options: {
                                    no_create: "True",
                                    no_open: "True",
                                },
                            },
                        }
                    );
                    self._registerWidget(
                        record.id,
                        self.analytic_group_id_m2o.name,
                        self.analytic_group_id_m2o
                    );
                    self.analytic_group_id_m2o.appendTo(self.getMisBuilderFilterBox());
                }
            }

            if (self.has_group_analytic_tags) {
                self.analytic_tag_ids_m2m = new relational_fields.FieldMany2ManyTags(
                    self,
                    "filter_analytic_tag_ids",
                    record,
                    {
                        mode: "edit",
                        attrs: {
                            placeholder: self.analytic_tag_ids_label,
                            options: {
                                no_create: "True",
                                no_open: "True",
                            },
                        },
                    }
                );
                self._registerWidget(
                    record.id,
                    self.analytic_tag_ids_m2m.name,
                    self.analytic_tag_ids_m2m
                );
                self.analytic_tag_ids_m2m.appendTo(self.getMisBuilderFilterBox());
            }
        },

        _makePartnerFilterFieldWidget: function (record) {
            var self = this;

            self.partner_id_m2o = new relational_fields.FieldMany2One(
                self,
                "filter_partner_id",
                record,
                {
                    mode: "edit",
                    attrs: {
                        placeholder: self.partner_id_label,
                        options: {
                            no_create: "True",
                            no_open: "True",
                        },
                    },
                }
            );
            self._registerWidget(
                record.id,
                self.partner_id_m2o.name,
                self.partner_id_m2o
            );
            self.partner_id_m2o.appendTo(self.getMisBuilderFilterBox());

        },

        _makeAccountFilterFieldWidget: function (record) {
            var self = this;

            self.account_id_m2o = new relational_fields.FieldMany2One(
                self,
                "filter_account_id",
                record,
                {
                    mode: "edit",
                    attrs: {
                        placeholder: self.account_id_label,
                        options: {
                            no_create: "True",
                            no_open: "True",
                        },
                    },
                }
            );
            self._registerWidget(
                record.id,
                self.account_id_m2o.name,
                self.account_id_m2o
            );
            self.account_id_m2o.appendTo(self.getMisBuilderFilterBox());

        },

        /**
         * Hack to work around Odoo not fetching display name for
         * x2many used with makeRecord.
         *
         * @returns a list of deferred
         * to be awaited before creating the widgets.
         *
         * @param {Object} record @see BasicModel.makeRecord
         */
        _beforeCreateWidgets: function (record) {
            var self = this;
            var defs = [];

            if (self.has_group_analytic_tags) {
                var dataPoint = record.data.filter_analytic_tag_ids;
                dataPoint.fieldsInfo.default.display_name = {};
                defs.push(self.model.reload(dataPoint.id));
            }

            return defs;
        },

        /**
         * Populate the analytic filters box.
         * This method is not meant to be overridden.
         */
        _addAnalyticFilters: function () {
            var self = this;
            if (self.hide_analytic_filter && self.hide_analytic_group_filter) {
                return;
            }
            self.model
                .makeRecord(
                    "dummy.model",
                    self._getFilterFields(),
                    self._getFilterFieldInfo()
                )
                .then(function (recordId) {
                    var record = self.model.get(recordId);
                    var defs = self._beforeCreateWidgets(record);
                    $.when.apply($, defs).then(function () {
                        record = self.model.get(record.id);
                        self._makeFilterFieldWidgets(record);
                    });
                });
        },

        _addPartnerFilter: function () {
            var self = this;
            if (self.hide_partner_filter) {
                return;
            }
            self.model
                .makeRecord(
                    "dummy.model",
                    self._getPartnerField(),
                    self._getFilterFieldInfo()
                )
                .then(function (recordId) {
                    var record = self.model.get(recordId);
                    var defs = [];
                    $.when.apply($, defs).then(function () {
                        record = self.model.get(record.id);
                        self._makePartnerFilterFieldWidget(record);
                    });
                });
        },

        _addAccountFilter: function () {
            var self = this;
            if (self.hide_partner_filter) {
                return;
            }
            self.model
                .makeRecord(
                    "dummy.model",
                    self._getAccountField(),
                    self._getFilterFieldInfo()
                )
                .then(function (recordId) {
                    var record = self.model.get(recordId);
                    var defs = [];
                    $.when.apply($, defs).then(function () {
                        record = self.model.get(record.id);
                        self._makeAccountFilterFieldWidget(record);
                    });
                });
        },

        _addAdditionalFilter: function () {
            var self = this;
            if (self.additional_filters.length < 1) {
                return;
            }

            var all_fields = {};
            self.additional_m2o = [];
        
            for(var i=0; i<self.additional_filters.length; i++) {

                var current_item = self.additional_filters[i];
                var tmp_field_name = "filter_" + current_item.field_name;

                var fields = [{
                    relation: current_item.model_name,
                    sequence: current_item.sequence,
                    domain: current_item.domain,
                    type: "many2one",
                    name: tmp_field_name,
                    value: self._getFilterValue(current_item.field_name),
                    descr: (current_item.custom_descr && current_item.custom_descr.trim() != "") ? current_item.custom_descr : current_item.model_descr,
                }];

                all_fields[tmp_field_name] = fields[0];

                self.model
                    .makeRecord(
                        "dummy.model",
                        fields,
                        self._getFilterFieldInfo()
                    )
                    .then(function (recordId) {
                        var record = self.model.get(recordId);
                        var defs = [];
                        $.when.apply($, defs).then(function () {
                            record = self.model.get(record.id);

                            var field_name = Object.keys(record.data)[0];
                            var field_refs = all_fields[field_name];

                            var additional_filter = new relational_fields.FieldMany2One(
                                self,
                                field_refs.name,
                                record,
                                {
                                    mode: "edit",
                                    attrs: {
                                        placeholder: field_refs.descr,
                                        options: {
                                            no_create: "True",
                                            no_open: "True",
                                            sequence: field_refs.sequence
                                        },
                                    },
                                }
                            );
                            self._registerWidget(
                                record.id,
                                additional_filter.name,
                                additional_filter
                            );

                            self.additional_m2o.push(
                                additional_filter
                            );

                            if(self.additional_m2o.length == self.additional_filters.length) {

                                self.additional_m2o.sort(function(a, b) {
                                    var x = a.nodeOptions.sequence; var y = b.nodeOptions.sequence;
                                    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
                                });

                                for(var k=0; k<self.additional_m2o.length; k++) {
                                    self.additional_m2o[k].appendTo(self.getMisBuilderAdditionalFilterBox());
                                }
                            }

                        });
                    });
            }
        },

        _confirmChange: function () {
            var self = this;
            var result = StandaloneFieldManagerMixin._confirmChange.apply(
                self,
                arguments
            );

            if (self.analytic_account_id_m2o !== undefined) {
                if (self.analytic_account_id_m2o.value) {
                    self._setFilterValue(
                        "analytic_account_id",
                        self.analytic_account_id_m2o.value.res_id,
                        "="
                    );
                } else {
                    self._setFilterValue("analytic_account_id", undefined);
                }
            }

            if (self.analytic_group_id_m2o !== undefined) {
                if (self.analytic_group_id_m2o.value) {
                    self._setFilterValue(
                        self.analytic_group_filter_name,
                        self.analytic_group_id_m2o.value.res_id,
                        "="
                    );
                } else {
                    self._setFilterValue(self.analytic_group_filter_name, undefined);
                }
            }

            if (self.analytic_tag_ids_m2m !== undefined) {
                if (
                    self.analytic_tag_ids_m2m.value &&
                    self.analytic_tag_ids_m2m.value.res_ids.length > 0
                ) {
                    self._setFilterValue(
                        "analytic_tag_ids",
                        self.analytic_tag_ids_m2m.value.res_ids,
                        "all"
                    );
                } else {
                    self._setFilterValue("analytic_tag_ids", undefined);
                }
            }

            if (self.partner_id_m2o !== undefined) {
                if (self.partner_id_m2o.value) {
                    self._setFilterValue(
                        "partner_id",
                        self.partner_id_m2o.value.res_id,
                        "="
                    );
                } else {
                    self._setFilterValue("partner_id", undefined);
                }
            }

            if (self.account_id_m2o !== undefined) {
                if (self.account_id_m2o.value) {
                    self._setFilterValue(
                        "account_id",
                        self.account_id_m2o.value.res_id,
                        "="
                    );
                } else {
                    self._setFilterValue("account_id", undefined);
                }
            }

            for(var i=0; i<self.additional_m2o.length; i++) {

                var current_field = self.additional_m2o[i];
                var current_filter_name = current_field.name.substring(7);

                if (current_field.value) {
                    self._setFilterValue(
                        current_filter_name,
                        current_field.value.res_id,
                        "="
                    );
                } else {
                    self._setFilterValue(current_filter_name, undefined);
                }

            }

            return result;
        },

        refresh: function () {
            this.replace();
        },

        printPdf: function () {
            var self = this;
            var context = self.getParent().state.context;
            this._rpc({
                model: "mis.report.instance",
                method: "print_pdf",
                args: [this._instanceId()],
                context: context,
            }).then(function (result) {
                self.do_action(result);
            });
        },

        exportXls: function () {
            var self = this;
            var context = self.getParent().state.context;
            this._rpc({
                model: "mis.report.instance",
                method: "export_xls",
                args: [this._instanceId()],
                context: context,
            }).then(function (result) {
                self.do_action(result);
            });
        },

        displaySettings: function () {
            var self = this;
            var context = self.getParent().state.context;
            this._rpc({
                model: "mis.report.instance",
                method: "display_settings",
                args: [this._instanceId()],
                context: context,
            }).then(function (result) {
                self.do_action(result);
            });
        },

        drilldown: function (event) {
            var self = this;
            var context = self.getParent().state.context;
            var drilldown_current = $(event.target).hasClass("drilldown_current");
            var drilldown = $(event.target).data("drilldown");
           
            if (drilldown_current){
                drilldown = $(event.target).parent().data("drilldown");
            }
            
            this._rpc({
                model: "mis.report.instance",
                method: "drilldown",
                args: [this._instanceId(), drilldown],
                context: context,
            }).then(function (result) {
                self.do_action(result);
            });
        },

        getMisBuilderFilterBox: function () {
            var self = this;
            return self.$(".oe_mis_builder_analytic_filter_box");
        },
        getMisBuilderAdditionalFilterBox: function () {
            var self = this;
            return self.$(".oe_mis_builder_additional_filter_box");
        },
    });

    field_registry.add("mis_report_widget", MisReportWidget);

    return MisReportWidget;
});
