function errorHandler(error, request, response, next) {
    response.status(500).json({
        code: 50000,
        message: 'Internal server error',
        data: null
    });
}

module.exports = errorHandler;
