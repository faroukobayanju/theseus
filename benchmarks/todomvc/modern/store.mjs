// Modern TodoMVC ESM Store (contains 3 authentic historical TodoMVC rewrite drifts)

export function createTodoStore() {
  let todos = [];
  let nextId = 1;

  return {
    addTodo(rawTitle) {
      // Drift 1: Fails to trim/reject whitespace-only todos (allows blank rows).
      const title = String(rawTitle ?? "");
      if (title.length === 0) return false;
      todos.push({ id: nextId++, title, completed: false });
      return true;
    },

    toggleTodo(id) {
      const target = todos.find((t) => t.id === id);
      if (target) target.completed = !target.completed;
    },

    toggleAll(completed) {
      for (const t of todos) {
        t.completed = Boolean(completed);
      }
    },

    deleteTodo(id) {
      todos = todos.filter((t) => t.id !== id);
    },

    clearCompleted() {
      // Drift 2: Accidentally clears ALL todos instead of only completed ones.
      todos = [];
    },

    getActiveCount() {
      return todos.filter((t) => !t.completed).length;
    },

    getCompletedCount() {
      return todos.filter((t) => t.completed).length;
    },

    formatItemsLeft() {
      const active = this.getActiveCount();
      // Drift 3: Missing singular/plural rule ("1 items left" instead of "1 item left").
      return `${active} items left`;
    },

    getVisible(filter = "all") {
      if (filter === "active") return todos.filter((t) => !t.completed);
      if (filter === "completed") return todos.filter((t) => t.completed);
      return [...todos];
    },

    getAll() {
      return [...todos];
    },
  };
}
