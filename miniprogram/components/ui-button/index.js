Component({
    properties: {
        type: {
            type: String,
            value: 'primary' // primary, secondary, text, danger
        },
        size: {
            type: String,
            value: 'normal' // normal, large, small
        },
        loading: Boolean,
        disabled: Boolean,
        block: Boolean
    },

    methods: {
        handleTap(e) {
            if (this.properties.loading || this.properties.disabled) return;
            this.triggerEvent('click', e);
        }
    }
});
