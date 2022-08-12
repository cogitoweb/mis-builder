
# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class AccountAccount(models.Model):
    _inherit = 'account.account'    

    # Fiedls

    hide_code_in_mis_report = fields.Boolean(
        default=False
    )