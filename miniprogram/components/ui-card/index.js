Component({
    properties: {
        // Allows full-width cards or padded ones
        full: {
            type: Boolean,
            value: false
        },
        // Optional title
        title: {
            type: String,
            value: ''
        }
    },
    externalClasses: ['custom-class']
});
