
export class Calculator {
    private lastResult: number = 0;

    constructor(public name: string) {}

    public add(a: number, b: number): number {
        this.lastResult = a + b;
        return this.lastResult;
    }

    public subtract(a: number, b: number): number {
        this.lastResult = a - b;
        return this.lastResult;
    }

    public multiply(a: number, b: number): number {
        this.lastResult = a * b;
        return this.lastResult;
    }

    public divide(a: number, b: number): number {
        if (b === 0) throw new Error("Division by zero");
        this.lastResult = a / b;
        return this.lastResult;
    }

    public getLastResult(): number {
        return this.lastResult;
    }
}
